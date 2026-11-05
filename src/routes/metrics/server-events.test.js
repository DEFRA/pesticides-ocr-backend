import { randomUUID } from 'node:crypto'
import { Collection } from 'mongodb'
import { SignJWT } from 'jose'
import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import {
  JOURNEY_SECRET,
  journeyToken,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const cases = [
  {
    path: '/metrics/journey-starts',
    event: 'server_journey_start',
    collection: JOURNEY_STARTS_COLLECTION,
    dateField: 'startedAt',
    status: 204
  },
  {
    path: '/metrics/journey-not-eligible',
    event: 'server_journey_not_eligible',
    collection: JOURNEY_NOT_ELIGIBLE_COLLECTION,
    dateField: 'endedAt',
    status: 204
  },
  {
    path: '/register',
    event: 'server_registration_complete',
    collection: OCR_REGISTRATION_COLLECTION,
    dateField: 'submittedAt',
    payload: validRegistrationPayload,
    status: 201
  }
]

describe('server journey events through the API', () => {
  let server
  let config
  let originalSettings
  let originalSecret
  let fetch

  beforeAll(async () => {
    const [{ createServer }, configModule] = await Promise.all([
      import('#/server.js'),
      import('#/config.js')
    ])
    config = configModule.config
    originalSettings = config.get('googleAnalytics')
    originalSecret = config.get('journeyToken.secret')
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    config.set('googleAnalytics.measurementId', 'G-SERVERTEST')
    config.set('googleAnalytics.apiSecret', 'private-test-secret')
    config.set('journeyToken.secret', JOURNEY_SECRET)
    fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    config.set('googleAnalytics', originalSettings)
    config.set('journeyToken.secret', originalSecret)
    await server.stop()
  })

  function post(
    milestone,
    { token = journeyToken(randomUUID()), cookie } = {}
  ) {
    return server.inject({
      method: 'POST',
      url: milestone.path,
      payload: milestone.payload,
      headers: {
        'x-journey-token': token,
        ...(cookie ? { cookie } : {})
      }
    })
  }

  describe.each(cases)('$event', (milestone) => {
    test.each(['accepted', 'rejected', 'withdrawn', 'unanswered'])(
      'records and sends with consent %s',
      async (choice) => {
        const nonce = randomUUID()
        const cookie =
          choice === 'unanswered'
            ? undefined
            : `cookies_policy=${encodeURIComponent(
                JSON.stringify({ analytics: choice === 'accepted' })
              )}`
        const before = await server.db
          .collection(milestone.collection)
          .countDocuments()
        const response = await post(milestone, {
          token: journeyToken(nonce),
          cookie
        })

        expect(response.statusCode).toBe(milestone.status)
        const collection = server.db.collection(milestone.collection)
        expect(await collection.countDocuments()).toBe(before + 1)
        const document = await collection.findOne(
          milestone.payload
            ? { reference: response.result.reference }
            : { nonce }
        )
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
          client_id: `server-metrics-${config.get('cdpEnvironment')}`,
          timestamp_micros: document[milestone.dateField].getTime() * 1000,
          events: [{ name: milestone.event }]
        })
      }
    )

    test('preserves the successful response and write when delivery fails', async () => {
      fetch.mockRejectedValue(new Error('GA unavailable private-test-secret'))
      const warn = vi.spyOn(createLogger(), 'warn').mockImplementation(() => {})
      const before = await server.db
        .collection(milestone.collection)
        .countDocuments()

      expect((await post(milestone)).statusCode).toBe(milestone.status)
      expect(
        await server.db.collection(milestone.collection).countDocuments()
      ).toBe(before + 1)
      expect(warn).toHaveBeenCalledWith(
        { event: milestone.event },
        'GA server event delivery failed'
      )
    })

    test('does not wait for GA before responding', async () => {
      let finishDelivery
      fetch.mockReturnValue(
        new Promise((resolve) => {
          finishDelivery = resolve
        })
      )
      try {
        expect((await post(milestone)).statusCode).toBe(milestone.status)
        expect(fetch).toHaveBeenCalledTimes(1)
      } finally {
        finishDelivery?.({ ok: true, status: 204 })
      }
    })

    test.each(['measurementId', 'apiSecret'])(
      'records without sending when %s is absent',
      async (setting) => {
        config.set(`googleAnalytics.${setting}`, '')

        expect((await post(milestone)).statusCode).toBe(milestone.status)
        expect(fetch).not.toHaveBeenCalled()
      }
    )
  })

  test.each(cases.slice(0, 2))(
    '$event is sent once when the same signed beacon is replayed',
    async (milestone) => {
      const nonce = randomUUID()
      const token = journeyToken(nonce)

      expect((await post(milestone, { token })).statusCode).toBe(204)
      expect((await post(milestone, { token })).statusCode).toBe(204)

      expect(
        await server.db
          .collection(milestone.collection)
          .countDocuments({ nonce })
      ).toBe(1)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  test('outbound server events match increases in GET /metrics/journeys', async () => {
    const token = await new SignJWT({ roles: ['case_officer'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('metrics-test-officer')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('mock-not-verified'))
    const metrics = async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics/journeys',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(response.statusCode).toBe(200)
      return response.result
    }
    const before = await metrics()
    for (const milestone of cases) {
      expect((await post(milestone)).statusCode).toBe(milestone.status)
    }
    const after = await metrics()

    expect({
      starts: after.starts - before.starts,
      notEligible: after.notEligible - before.notEligible,
      registrations: after.registrations - before.registrations,
      finished: after.finished - before.finished
    }).toEqual({ starts: 1, notEligible: 1, registrations: 1, finished: 2 })
    expect(
      fetch.mock.calls.map(
        ([, options]) => JSON.parse(options.body).events[0].name
      )
    ).toEqual(cases.map(({ event }) => event))
  })

  test('sends nothing for a rolled-back registration', async () => {
    const before = await server.db
      .collection(OCR_REGISTRATION_COLLECTION)
      .countDocuments()
    const insertOne = Collection.prototype.insertOne
    vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(function (
      ...args
    ) {
      if (this.collectionName === OCR_REGISTRATION_HISTORY_COLLECTION) {
        throw new Error('history write failed')
      }
      return insertOne.apply(this, args)
    })

    expect((await post(cases[2])).statusCode).toBe(500)
    expect(
      await server.db.collection(OCR_REGISTRATION_COLLECTION).countDocuments()
    ).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
  })
})
