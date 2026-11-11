import { createHmac } from 'node:crypto'
import { SignJWT } from 'jose'
import {
  FEEDBACK_STARTS_COLLECTION,
  FEEDBACK_COMPLETIONS_COLLECTION
} from '#/common/constants/collections.js'

const SECRET = 'feedback-test-secret'
const token = (nonce) =>
  `${nonce}.${createHmac('sha256', SECRET).update(nonce).digest('hex')}`

describe('feedback metrics', () => {
  let server
  let config
  let originalSecret
  let officerToken

  beforeAll(async () => {
    const modules = await Promise.all([
      import('#/server.js'),
      import('#/config.js')
    ])
    config = modules[1].config
    originalSecret = config.get('journeyToken.secret')
    config.set('journeyToken.secret', SECRET)
    server = await modules[0].createServer()
    await server.initialize()
    officerToken = await new SignJWT({ roles: ['case_officer'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('feedback-officer')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('mock-not-verified'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    config.set('journeyToken.secret', SECRET)
    await Promise.all([
      server.db.collection(FEEDBACK_STARTS_COLLECTION).deleteMany({}),
      server.db.collection(FEEDBACK_COMPLETIONS_COLLECTION).deleteMany({})
    ])
  })

  afterAll(async () => {
    config.set('journeyToken.secret', originalSecret)
    await server.stop()
  })

  test('each session can record one of each event, storing only timestamp and nonce', async () => {
    for (const [path, collection, dateField] of [
      ['/metrics/feedback-starts', FEEDBACK_STARTS_COLLECTION, 'startedAt'],
      [
        '/metrics/feedback-completions',
        FEEDBACK_COMPLETIONS_COLLECTION,
        'completedAt'
      ]
    ]) {
      const request = {
        method: 'POST',
        url: path,
        headers: { 'x-journey-token': token('same-session') },
        payload: { applicant: 'must not be stored' }
      }
      const responses = await Promise.all([
        server.inject(request),
        server.inject(request)
      ])
      expect(responses.map(({ statusCode }) => statusCode)).toEqual([204, 204])
      const docs = await server.db
        .collection(collection)
        .find({}, { projection: { _id: 0 } })
        .toArray()
      expect(docs).toEqual([
        { [dateField]: expect.any(Date), nonce: 'same-session' }
      ])
    }
  })

  test.each([
    ['/metrics/feedback-starts', FEEDBACK_STARTS_COLLECTION, 'startedAt'],
    [
      '/metrics/feedback-completions',
      FEEDBACK_COMPLETIONS_COLLECTION,
      'completedAt'
    ]
  ])(
    '%s counts each unsigned call when the journey token secret is unset',
    async (path, collection, dateField) => {
      config.set('journeyToken.secret', '')
      const request = { method: 'POST', url: path }

      expect((await server.inject(request)).statusCode).toBe(204)
      expect((await server.inject(request)).statusCode).toBe(204)

      const documents = await server.db
        .collection(collection)
        .find({}, { projection: { _id: 0 } })
        .toArray()
      expect(documents).toEqual([
        { [dateField]: expect.any(Date) },
        { [dateField]: expect.any(Date) }
      ])
    }
  )

  test('returns an explicit failure when storage fails', async () => {
    vi.spyOn(server.db, 'collection').mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(new Error('database unavailable'))
    })
    const response = await server.inject({
      method: 'POST',
      url: '/metrics/feedback-starts',
      headers: { 'x-journey-token': token('failed-write') }
    })
    expect(response.statusCode).toBe(500)
  })

  test('includes the whole to date for both feedback metrics and excludes adjacent days', async () => {
    for (const [collection, dateField] of [
      [FEEDBACK_STARTS_COLLECTION, 'startedAt'],
      [FEEDBACK_COMPLETIONS_COLLECTION, 'completedAt']
    ]) {
      await server.db
        .collection(collection)
        .insertMany(
          [
            '2026-01-01T23:59:59.999Z',
            '2026-01-02T10:00:00Z',
            '2026-01-02T23:59:59.999Z',
            '2026-01-03T00:00:00Z'
          ].map((timestamp) => ({ [dateField]: new Date(timestamp) }))
        )
    }

    const response = await server.inject({
      method: 'GET',
      url: '/metrics/journeys?from=2026-01-02&to=2026-01-02',
      headers: { authorization: `Bearer ${officerToken}` }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toMatchObject({
      feedbackStarted: 2,
      feedbackCompleted: 2,
      byMonth: [{ month: '2026-01', feedbackStarted: 2, feedbackCompleted: 2 }],
      byYear: [{ year: '2026', feedbackStarted: 2, feedbackCompleted: 2 }]
    })
  })

  test('includes feedback-only months and years and applies date filters without changing journey rates', async () => {
    await server.db
      .collection(FEEDBACK_STARTS_COLLECTION)
      .insertMany([
        { startedAt: new Date('2025-12-01T10:00:00Z') },
        { startedAt: new Date('2026-01-01T10:00:00Z') },
        { startedAt: new Date('2026-01-02T10:00:00Z') }
      ])
    await server.db.collection(FEEDBACK_COMPLETIONS_COLLECTION).insertOne({
      completedAt: new Date('2026-02-01T10:00:00Z')
    })
    const get = (query = '') =>
      server.inject({
        method: 'GET',
        url: `/metrics/journeys${query}`,
        headers: { authorization: `Bearer ${officerToken}` }
      })

    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.result).toMatchObject({
      feedbackStarted: 3,
      feedbackCompleted: 1,
      finished: 0,
      dropOuts: 0,
      completionRate: null,
      byMonth: [
        { month: '2025-12', feedbackStarted: 1, feedbackCompleted: 0 },
        { month: '2026-01', feedbackStarted: 2, feedbackCompleted: 0 },
        { month: '2026-02', feedbackStarted: 0, feedbackCompleted: 1 }
      ],
      byYear: [
        { year: '2025', feedbackStarted: 1, feedbackCompleted: 0 },
        { year: '2026', feedbackStarted: 2, feedbackCompleted: 1 }
      ]
    })
    const filtered = await get('?from=2026-01-02&to=2026-01-31')
    expect(filtered.result).toMatchObject({
      feedbackStarted: 1,
      feedbackCompleted: 0,
      byMonth: [{ month: '2026-01', feedbackStarted: 1, feedbackCompleted: 0 }],
      byYear: [{ year: '2026', feedbackStarted: 1, feedbackCompleted: 0 }]
    })
  })
})
