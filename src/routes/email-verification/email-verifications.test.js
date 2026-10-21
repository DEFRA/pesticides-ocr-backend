import { createHmac } from 'node:crypto'
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
  EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
} from '#/common/constants/collections.js'
import {
  networkErrorMock,
  notifyRejectionMock,
  successfulSendEmailMock
} from '#/services/notify/notify.fixtures.js'
import { hashLinkToken } from '#/services/email-verification/link-token.js'

const JOURNEY_SECRET = 'journey-test-secret'
const LINK_BASE_URL = 'https://ocr.example.gov.uk'
const TEMPLATE_ID = 'email-verification-template-id'

// notify.js reads its config when first imported, so the settings it needs
// must be in place before anything imports it.
const { mockSendEmail, testEnv } = vi.hoisted(() => {
  const env = {
    JOURNEY_TOKEN_SECRET: 'journey-test-secret',
    EMAIL_VERIFICATION_HASH_SECRET: 'hash-test-secret',
    EMAIL_VERIFICATION_LINK_BASE_URL: 'https://ocr.example.gov.uk',
    NOTIFY_API_KEY: 'notify-test-key',
    NOTIFY_TEMPLATE_EMAIL_VERIFICATION_LINK: 'email-verification-template-id'
  }
  Object.assign(process.env, env)
  return { mockSendEmail: vi.fn(), testEnv: env }
})

vi.mock('notifications-node-client', () => ({
  NotifyClient: vi.fn(function () {
    return { sendEmail: mockSendEmail }
  })
}))

// Audit events are asserted in audit-and-metrics.test.js.
vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

const START = new Date('2030-01-01T10:00:00.000Z')
const secondsAfterStart = (seconds) =>
  new Date(START.getTime() + seconds * 1000)

const journeyToken = (nonce) =>
  `${nonce}.${createHmac('sha256', JOURNEY_SECRET).update(nonce).digest('hex')}`

const JOURNEY = 'journey-0f2b8c1e-7a4d-4e9b-9c6f-1d2e3f4a5b6c'
const EMAIL = 'jane.smith@example.com'

describe('POST /email-verifications', () => {
  let server
  let config
  let logger
  let records
  let rateLimits
  let originalSettings

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
    server = await createServer()
    await server.initialize()
    records = server.db.collection(EMAIL_VERIFICATIONS_COLLECTION)
    rateLimits = server.db.collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    config.set('emailVerification', structuredClone(originalSettings))
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)
    for (const level of ['debug', 'info', 'warn', 'error']) {
      vi.spyOn(logger, level)
    }
    await records.deleteMany({})
    await rateLimits.deleteMany({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    for (const name of Object.keys(testEnv)) {
      delete process.env[name]
    }
  })

  const request = ({
    email = EMAIL,
    journeyId = JOURNEY,
    payload = { email },
    headers = { 'x-journey-token': journeyToken(journeyId) }
  } = {}) =>
    server.inject({
      method: 'POST',
      url: '/email-verifications',
      headers,
      payload
    })

  const sentLink = (call = 0) =>
    mockSendEmail.mock.calls[call][2].personalisation.verification_link
  const sentToken = (call = 0) =>
    new URL(sentLink(call)).searchParams.get('token')
  const liveRecords = () => records.find({ status: 'pending' }).toArray()
  const heldCounts = async () =>
    (await rateLimits.find({ count: { $gt: 0 } }).toArray()).map(
      ({ count }) => count
    )
  const at = (seconds) => vi.setSystemTime(secondsAfterStart(seconds))

  describe('success', () => {
    test('returns 202 with only the expiry and the resend time', async () => {
      const response = await request()

      expect(response.statusCode).toBe(202)
      expect(response.result).toEqual({
        expiresAt: '2030-01-01T10:15:00.000Z',
        resendAvailableAt: '2030-01-01T10:01:00.000Z'
      })
    })

    test('emails a link with the token and expiry, through the configured template', async () => {
      await request()

      expect(mockSendEmail).toHaveBeenCalledOnce()
      expect(mockSendEmail).toHaveBeenCalledWith(TEMPLATE_ID, EMAIL, {
        personalisation: {
          verification_link: expect.stringMatching(
            /^https:\/\/ocr\.example\.gov\.uk\/verify-email\?token=[A-Za-z0-9_-]{43}$/
          ),
          expiry_minutes: 15
        }
      })
    })

    test('stores a pending record holding only the token hash', async () => {
      await request()

      const [record] = await records.find().toArray()
      expect(record).toMatchObject({
        journeyId: JOURNEY,
        email: EMAIL,
        tokenHash: hashLinkToken(sentToken()),
        status: 'pending',
        createdAt: START,
        expiresAt: secondsAfterStart(900),
        purgeAt: secondsAfterStart(86400)
      })
      expect(JSON.stringify(record)).not.toContain(sentToken())
    })

    test('trims and lower-cases the address before sending and storing it', async () => {
      await request({ email: '  Jane.Smith@Example.COM ' })

      expect(mockSendEmail.mock.calls[0][1]).toBe(EMAIL)
      expect((await records.findOne()).email).toBe(EMAIL)
    })

    test('does not return the email address, token or record id', async () => {
      const response = await request()
      const [record] = await records.find().toArray()

      expect(response.payload).not.toContain(EMAIL)
      expect(response.payload).not.toContain(sentToken())
      expect(response.payload).not.toContain(record._id.toString())
      expect(response.payload).not.toContain(record.tokenHash)
    })

    test('a resend supersedes the earlier link, leaving only the new one live', async () => {
      await request()
      at(61)

      const response = await request({ email: 'new.address@example.com' })

      expect(response.statusCode).toBe(202)
      const [first, second] = await records
        .find()
        .sort({ createdAt: 1 })
        .toArray()
      expect(first).toMatchObject({
        status: 'superseded',
        supersededAt: secondsAfterStart(61)
      })
      expect(second).toMatchObject({
        status: 'pending',
        email: 'new.address@example.com',
        tokenHash: hashLinkToken(sentToken(1))
      })
    })

    test('does not touch another journey’s link', async () => {
      await request({ journeyId: 'other-journey' })

      await request()

      expect(await liveRecords()).toHaveLength(2)
    })
  })

  describe('validation', () => {
    test.each([
      ['the email is missing', {}],
      ['the email is empty', { email: '' }],
      ['the email is not an address', { email: 'not-an-email' }],
      ['the email is too long', { email: `${'a'.repeat(243)}@example.com` }],
      ['the email is not a string', { email: ['jane@example.com'] }],
      ['there is an unknown field', { email: EMAIL, journeyId: 'another' }]
    ])('returns 400 VALIDATION_ERROR when %s', async (_label, payload) => {
      const response = await request({ payload })

      expect(response.statusCode).toBe(400)
      expect(response.result).toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(await records.countDocuments()).toBe(0)
    })

    test('accepts an address of exactly 254 characters', async () => {
      const response = await request({
        email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.uk`
      })

      expect(response.statusCode).toBe(202)
    })

    test('refuses a body over 1 KB', async () => {
      const response = await request({
        payload: { email: EMAIL, padding: 'x'.repeat(1024) }
      })

      expect(response.statusCode).toBe(413)
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    test.each([
      ['missing', {}],
      ['unsigned', { 'x-journey-token': JOURNEY }],
      ['forged', { 'x-journey-token': `${JOURNEY}.${'0'.repeat(64)}` }]
    ])(
      'returns 401 JOURNEY_TOKEN_INVALID when the journey token is %s',
      async (_label, headers) => {
        const response = await request({ headers })

        expect(response.statusCode).toBe(401)
        expect(response.result).toMatchObject({ code: 'JOURNEY_TOKEN_INVALID' })
        expect(mockSendEmail).not.toHaveBeenCalled()
      }
    )
  })

  describe('configuration', () => {
    const keys = [
      'journeyToken.secret',
      'emailVerification.hashSecret',
      'emailVerification.linkBaseUrl',
      'notify.apiKey',
      'notify.templates.emailVerificationLink'
    ]
    let original

    beforeEach(() => {
      original = Object.fromEntries(keys.map((key) => [key, config.get(key)]))
    })

    afterEach(() => {
      for (const [key, value] of Object.entries(original)) {
        config.set(key, value)
      }
    })

    test.each(keys)(
      'returns 503 SERVICE_NOT_CONFIGURED when %s is empty',
      async (key) => {
        config.set(key, '')

        const response = await request()

        expect(response.statusCode).toBe(503)
        expect(response.result).toMatchObject({
          code: 'SERVICE_NOT_CONFIGURED'
        })
        expect(mockSendEmail).not.toHaveBeenCalled()
        expect(await rateLimits.countDocuments()).toBe(0)
      }
    )
  })

  describe('rate limiting', () => {
    const expectRefused = (response, code, retryAfter) => {
      expect(response.statusCode).toBe(429)
      expect(response.result).toMatchObject({ code })
      expect(response.headers['retry-after']).toBe(String(retryAfter))
    }

    test('returns 429 RESEND_COOLDOWN within the cooldown, and sends nothing', async () => {
      await request()
      at(20)

      const response = await request()

      expectRefused(response, 'RESEND_COOLDOWN', 40)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      expect(await records.countDocuments()).toBe(1)
    })

    test('accepts the journey again once the cooldown has passed', async () => {
      await request()
      at(60)

      expect((await request()).statusCode).toBe(202)
    })

    test('returns 429 RATE_LIMITED after 5 sends to one address in the hour', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await request({ journeyId: `journey-${i}` })).statusCode).toBe(
          202
        )
      }
      at(600)

      const response = await request({ journeyId: 'journey-5' })

      expectRefused(response, 'RATE_LIMITED', 3000)
      expect(mockSendEmail).toHaveBeenCalledTimes(5)
    })

    test('returns 429 RATE_LIMITED after 5 sends for one journey in the hour', async () => {
      for (let i = 0; i < 5; i++) {
        at(i * 60)
        expect(
          (await request({ email: `applicant-${i}@example.com` })).statusCode
        ).toBe(202)
      }
      at(1800)

      const response = await request({ email: 'applicant-5@example.com' })

      expectRefused(response, 'RATE_LIMITED', 1800)
      expect(mockSendEmail).toHaveBeenCalledTimes(5)
    })

    test('returns 429 RATE_LIMITED when the global cap is reached', async () => {
      config.set('emailVerification.maxSendsGlobalPerHour', 2)
      await request({ journeyId: 'journey-1', email: 'one@example.com' })
      await request({ journeyId: 'journey-2', email: 'two@example.com' })

      const response = await request({
        journeyId: 'journey-3',
        email: 'three@example.com'
      })

      expectRefused(response, 'RATE_LIMITED', 3600)
      expect(mockSendEmail).toHaveBeenCalledTimes(2)
    })

    test('gives the same response whichever cap was hit', async () => {
      for (let i = 0; i < 5; i++) {
        await request({ journeyId: `journey-${i}` })
      }
      const emailCap = await request({ journeyId: 'journey-5' })
      config.set('emailVerification.maxSendsGlobalPerHour', 5)
      const globalCap = await request({
        journeyId: 'journey-6',
        email: 'someone.else@example.com'
      })

      expect(globalCap.result).toEqual(emailCap.result)
      expect(globalCap.headers['retry-after']).toBe(
        emailCap.headers['retry-after']
      )
    })

    test('accepts the address again when the next hour’s window starts', async () => {
      for (let i = 0; i < 5; i++) {
        await request({ journeyId: `journey-${i}` })
      }
      expect((await request({ journeyId: 'journey-5' })).statusCode).toBe(429)
      at(3600)

      expect((await request({ journeyId: 'journey-5' })).statusCode).toBe(202)
    })

    test('a refused request uses up no quota', async () => {
      await request()
      at(10)
      await request()
      await request()

      expect(await heldCounts()).toEqual([1, 1, 1])
    })
  })

  describe('Notify failure', () => {
    test.each([
      ['Notify refuses the email (400)', notifyRejectionMock],
      ['Notify is unreachable', networkErrorMock]
    ])(
      'returns 502 EMAIL_SEND_FAILED when %s, leaving no record and no quota used',
      async (_label, failure) => {
        mockSendEmail.mockRejectedValueOnce(failure())

        const response = await request()

        expect(response.statusCode).toBe(502)
        expect(response.result).toMatchObject({ code: 'EMAIL_SEND_FAILED' })
        expect(await records.countDocuments()).toBe(0)
        expect(await heldCounts()).toEqual([])
      }
    )

    test('lets the applicant try again straight away', async () => {
      mockSendEmail.mockRejectedValueOnce(networkErrorMock())
      await request()

      const response = await request()

      expect(response.statusCode).toBe(202)
      expect(await liveRecords()).toHaveLength(1)
    })

    test('leaves the earlier link live when a resend fails', async () => {
      await request()
      at(61)
      mockSendEmail.mockRejectedValueOnce(notifyRejectionMock())

      await request()

      const [live] = await liveRecords()
      expect(live.tokenHash).toBe(hashLinkToken(sentToken(0)))
    })
  })

  describe('concurrency', () => {
    test('parallel requests for a journey send one link and count it once', async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => request())
      )

      const codes = responses.map(({ statusCode }) => statusCode).sort()
      expect(codes).toEqual([202, ...Array(9).fill(429)])
      expect(mockSendEmail).toHaveBeenCalledOnce()
      expect(await liveRecords()).toHaveLength(1)
      expect(await heldCounts()).toEqual([1, 1, 1])
    })

    // A refused request holds its count until it gives it back, so a burst can
    // let fewer than the cap through, but never more.
    test('parallel requests to one address never exceed its cap', async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request({ journeyId: `journey-${i}` })
        )
      )

      const accepted = responses.filter(({ statusCode }) => statusCode === 202)
      expect(accepted.length).toBeGreaterThan(0)
      expect(accepted.length).toBeLessThanOrEqual(5)
      expect(mockSendEmail).toHaveBeenCalledTimes(accepted.length)
      expect(await liveRecords()).toHaveLength(accepted.length)
      const emailCounter = await rateLimits.findOne({ _id: /^email:/ })
      expect(emailCounter.count).toBe(accepted.length)
    })
  })

  describe('logging', () => {
    const loggedText = () =>
      JSON.stringify(
        ['debug', 'info', 'warn', 'error'].flatMap(
          (level) => logger[level].mock.calls
        ),
        (_key, value) =>
          value instanceof Error ? { ...value, message: value.message } : value
      )

    test('logs no token, link or email address on success, refusal or failure', async () => {
      await request({ email: '  Jane.Smith@Example.COM ' })
      await request()
      at(61)
      mockSendEmail.mockRejectedValueOnce(notifyRejectionMock())
      await request()
      await request({ payload: { email: 'jane.smith@example', extra: EMAIL } })

      const logged = loggedText()
      expect(logger.info).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalled()
      expect(logged).not.toContain(sentToken())
      expect(logged).not.toContain(hashLinkToken(sentToken()))
      expect(logged).not.toContain(LINK_BASE_URL)
      expect(logged.toLowerCase()).not.toContain('jane.smith@example')
      expect(logged).not.toContain('a.b@defra.gov.uk')
    })
  })
})
