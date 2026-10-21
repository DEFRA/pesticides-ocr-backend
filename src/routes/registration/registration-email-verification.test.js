import {
  describe,
  test,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll
} from 'vitest'

import {
  EMAIL_VERIFICATIONS_COLLECTION,
  OCR_REGISTRATION_COLLECTION
} from '#/common/constants/collections.js'
import { REGISTRATION_EMAIL_NOT_VERIFIED } from '#/common/constants/audit-events.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'
import { METRICS } from '#/services/email-verification/metrics.js'
import {
  CONTACT_EMAIL,
  JOURNEY,
  JOURNEY_SECRET,
  OTHER_JOURNEY,
  journeyToken,
  seedVerification,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'

const HASH_SECRET = 'hash-test-secret'

const { mockAudit, mockCounter } = vi.hoisted(() => ({
  mockAudit: vi.fn(),
  mockCounter: vi.fn()
}))

vi.mock('@defra/cdp-auditing', () => ({ audit: mockAudit }))

vi.mock('@defra/cdp-metrics', async (importOriginal) => ({
  ...(await importOriginal()),
  Metrics: vi.fn(function () {
    return { counter: mockCounter }
  })
}))

const START = new Date('2030-01-01T10:00:00.000Z')
const secondsAfterStart = (seconds) =>
  new Date(START.getTime() + seconds * 1000)

const withContactEmail = (contactEmail) => ({
  ...validRegistrationPayload,
  primaryContact: { ...validRegistrationPayload.primaryContact, contactEmail }
})

// POST /register against the real verification records and registrations
// collection, so the gate's query is exercised as it runs in production.
describe('POST /register: email verification gate', () => {
  let server
  let config
  let logger
  let registrations
  let originalSettings
  let originalJourneySecret

  beforeAll(async () => {
    // Imported here so config reads the in-memory MONGO_URI.
    const [{ createServer }, configModule, loggerModule] = await Promise.all([
      import('#/server.js'),
      import('#/config.js'),
      import('#/common/helpers/logging/logger.js')
    ])
    config = configModule.config
    logger = loggerModule.createLogger()
    originalSettings = structuredClone(config.get('emailVerification'))
    originalJourneySecret = config.get('journeyToken.secret')
    server = await createServer()
    await server.initialize()
    registrations = server.db.collection(OCR_REGISTRATION_COLLECTION)
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    config.set('emailVerification', {
      ...structuredClone(originalSettings),
      hashSecret: HASH_SECRET,
      requiredForRegistration: true
    })
    config.set('journeyToken.secret', JOURNEY_SECRET)
    mockAudit.mockReset()
    mockCounter.mockReset().mockResolvedValue(undefined)
    for (const level of ['debug', 'info', 'warn', 'error']) {
      vi.spyOn(logger, level)
    }
    await server.db.collection(EMAIL_VERIFICATIONS_COLLECTION).deleteMany({})
    await registrations.deleteMany({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    config.set('emailVerification', originalSettings)
    config.set('journeyToken.secret', originalJourneySecret)
    await server.stop({ timeout: 0 })
  })

  const register = ({
    journeyId = JOURNEY,
    payload = validRegistrationPayload,
    headers = { 'x-journey-token': journeyToken(journeyId) }
  } = {}) =>
    server.inject({ method: 'POST', url: '/register', headers, payload })

  const expectRefused = async (response, statusCode, code) => {
    expect(response.statusCode).toBe(statusCode)
    expect(JSON.parse(response.payload)).toMatchObject({ statusCode, code })
    expect(await registrations.countDocuments()).toBe(0)
  }

  const expectNotVerified = (response) =>
    expectRefused(response, 403, 'EMAIL_NOT_VERIFIED')

  const expectSaved = async (response) => {
    expect(response.statusCode).toBe(201)
    const { reference } = JSON.parse(response.payload)
    expect(await registrations.findOne({ reference })).not.toBeNull()
  }

  describe('a verified contact email', () => {
    test('is saved and returns the reference, as before', async () => {
      await seedVerification(server.db)

      const response = await register()

      await expectSaved(response)
      expect(Object.keys(JSON.parse(response.payload))).toEqual(['reference'])
      expect(mockAudit).not.toHaveBeenCalled()
    })

    test('matches whatever the case of the submitted address', async () => {
      await seedVerification(server.db)

      await expectSaved(
        await register({ payload: withContactEmail('Spray@Everything.BIZ') })
      )
    })

    test('counts until the verified TTL has passed', async () => {
      await seedVerification(server.db)
      vi.setSystemTime(
        secondsAfterStart(originalSettings.verifiedTtlSeconds - 1)
      )

      await expectSaved(await register())
    })

    test('is only checked after validation, so a bad payload is still a 400', async () => {
      const response = await register({
        payload: withContactEmail('not-an-email'),
        headers: {}
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('a contact email that is not verified for the journey', () => {
    test('is refused when it was never verified', async () => {
      await expectNotVerified(await register())
    })

    test('is refused while its link is still pending', async () => {
      await seedVerification(server.db)
      await server.db
        .collection(EMAIL_VERIFICATIONS_COLLECTION)
        .updateMany({}, { $set: { status: 'pending', verifiedAt: null } })

      await expectNotVerified(await register())
    })

    test('is refused when it was verified on another journey', async () => {
      await seedVerification(server.db, { journeyId: OTHER_JOURNEY })

      await expectNotVerified(await register())
    })

    test('is refused when the address changed after verification', async () => {
      await seedVerification(server.db)

      await expectNotVerified(
        await register({ payload: withContactEmail('new.address@example.com') })
      )
    })

    test('is refused once the verified TTL has passed', async () => {
      await seedVerification(server.db)
      vi.setSystemTime(secondsAfterStart(originalSettings.verifiedTtlSeconds))

      await expectNotVerified(await register())
    })

    test('audits and counts the refusal, by email hash only', async () => {
      await register()

      expect(mockAudit).toHaveBeenCalledExactlyOnceWith(
        {
          event: REGISTRATION_EMAIL_NOT_VERIFIED,
          journeyId: JOURNEY,
          emailHash: hashEmail(CONTACT_EMAIL, HASH_SECRET)
        },
        REGISTRATION_EMAIL_NOT_VERIFIED
      )
      expect(mockCounter).toHaveBeenCalledExactlyOnceWith(
        METRICS.REGISTRATION_NOT_VERIFIED,
        1,
        {}
      )
    })

    test('logs, audits and counts no email address', async () => {
      await register({ payload: withContactEmail('Spray@Everything.BIZ') })

      const emitted = JSON.stringify([
        ['debug', 'info', 'warn', 'error'].flatMap(
          (level) => logger[level].mock.calls
        ),
        mockAudit.mock.calls,
        mockCounter.mock.calls
      ]).toLowerCase()
      expect(logger.info).toHaveBeenCalled()
      expect(emitted).not.toContain('spray')
      expect(emitted).not.toContain('everything.biz')
    })
  })

  describe('the journey token', () => {
    test('is required', async () => {
      await seedVerification(server.db)

      await expectRefused(
        await register({ headers: {} }),
        401,
        'JOURNEY_TOKEN_INVALID'
      )
    })

    test('must be signed with the shared secret', async () => {
      await seedVerification(server.db)

      await expectRefused(
        await register({
          headers: { 'x-journey-token': journeyToken(JOURNEY, 'wrong') }
        }),
        401,
        'JOURNEY_TOKEN_INVALID'
      )
    })

    test('cannot be checked without JOURNEY_TOKEN_SECRET, so nothing is saved', async () => {
      await seedVerification(server.db)
      config.set('journeyToken.secret', '')

      await expectRefused(await register(), 503, 'SERVICE_NOT_CONFIGURED')
    })
  })

  describe('with the gate turned off', () => {
    beforeEach(() => {
      config.set('emailVerification.requiredForRegistration', false)
    })

    test('saves without a journey token or a verification', async () => {
      await expectSaved(await register({ headers: {} }))
      expect(mockAudit).not.toHaveBeenCalled()
      expect(mockCounter).not.toHaveBeenCalled()
    })
  })

  test('returns 500 and saves nothing when the check fails', async () => {
    vi.spyOn(server.db, 'collection').mockImplementationOnce(() => {
      throw new Error('connection reset')
    })

    const response = await register()

    expect(response.statusCode).toBe(500)
    expect(await registrations.countDocuments()).toBe(0)
  })
})
