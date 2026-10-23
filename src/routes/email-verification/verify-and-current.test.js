import { createHmac } from 'node:crypto'
import { Collection } from 'mongodb'
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
import { successfulSendEmailMock } from '#/services/notify/notify.fixtures.js'
import {
  generateLinkToken,
  hashLinkToken
} from '#/services/email-verification/link-token.js'
import { insertSendingRecord } from '#/services/email-verification/verification-records.js'

const JOURNEY_SECRET = 'journey-test-secret'

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
const isoAfterStart = (seconds) => secondsAfterStart(seconds).toISOString()

const journeyToken = (nonce) =>
  `${nonce}.${createHmac('sha256', JOURNEY_SECRET).update(nonce).digest('hex')}`

const JOURNEY = 'journey-0f2b8c1e-7a4d-4e9b-9c6f-1d2e3f4a5b6c'
const OTHER_JOURNEY = 'journey-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const EMAIL = 'jane.smith@example.com'
const UNKNOWN_TOKEN = 'A'.repeat(43)

describe('email verification: verify and current status', () => {
  let server
  let config
  let logger
  let records
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
    records = server.db.collection(EMAIL_VERIFICATIONS_COLLECTION)
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    config.set('emailVerification', structuredClone(originalSettings))
    config.set('journeyToken.secret', originalJourneySecret)
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)
    for (const level of ['debug', 'info', 'warn', 'error']) {
      vi.spyOn(logger, level)
    }
    await records.deleteMany({})
    await server.db
      .collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)
      .deleteMany({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    config.set('journeyToken.secret', originalJourneySecret)
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    for (const name of Object.keys(testEnv)) {
      delete process.env[name]
    }
  })

  const at = (seconds) => vi.setSystemTime(secondsAfterStart(seconds))
  const journeyHeaders = (journeyId) =>
    journeyId ? { 'x-journey-token': journeyToken(journeyId) } : {}

  // Requests a link through the real endpoint and returns the emailed token.
  const sendLink = async ({ journeyId = JOURNEY, email = EMAIL } = {}) => {
    const response = await server.inject({
      method: 'POST',
      url: '/email-verifications',
      headers: journeyHeaders(journeyId),
      payload: { email }
    })
    expect(response.statusCode).toBe(202)
    const link =
      mockSendEmail.mock.lastCall[2].personalisation.verification_link
    return new URL(link).searchParams.get('token')
  }

  const verify = (
    token,
    { journeyId = JOURNEY, headers = journeyHeaders(journeyId) } = {}
  ) =>
    server.inject({
      method: 'POST',
      url: '/email-verifications/verify',
      headers,
      payload: { token }
    })

  const current = ({
    journeyId = JOURNEY,
    headers = journeyHeaders(journeyId)
  } = {}) =>
    server.inject({
      method: 'GET',
      url: '/email-verifications/current',
      headers
    })

  const recordFor = (token) =>
    records.findOne({ tokenHash: hashLinkToken(token) })

  describe('POST /email-verifications/verify', () => {
    test('returns 200 VERIFIED with sameJourney: true from the journey that asked', async () => {
      const token = await sendLink()
      at(30)

      const response = await verify(token)

      expect(response.statusCode).toBe(200)
      expect(response.result).toEqual({
        outcome: 'VERIFIED',
        sameJourney: true
      })
      expect(await recordFor(token)).toMatchObject({
        journeyId: JOURNEY,
        status: 'verified',
        verifiedAt: secondsAfterStart(30)
      })
    })

    test.each([
      ['has no journey token', {}],
      ['is from another journey', journeyHeaders(OTHER_JOURNEY)],
      [
        'has a forged journey token',
        { 'x-journey-token': `${JOURNEY}.${'0'.repeat(64)}` }
      ]
    ])(
      'still verifies, with sameJourney: false, when the caller %s',
      async (_label, headers) => {
        const token = await sendLink()

        const response = await verify(token, { headers })

        expect(response.statusCode).toBe(200)
        expect(response.result).toEqual({
          outcome: 'VERIFIED',
          sameJourney: false
        })
        // Recorded against the journey that asked for the link.
        expect(await recordFor(token)).toMatchObject({
          journeyId: JOURNEY,
          status: 'verified'
        })
      }
    )

    test('still verifies when the journey token secret is not configured', async () => {
      const token = await sendLink()
      config.set('journeyToken.secret', '')

      const response = await verify(token)

      expect(response.statusCode).toBe(200)
      expect(response.result).toEqual({
        outcome: 'VERIFIED',
        sameJourney: false
      })
    })

    describe('a malformed token', () => {
      test.each([
        ['is missing', {}],
        ['is empty', { token: '' }],
        ['is too short', { token: 'A'.repeat(42) }],
        ['is too long', { token: 'A'.repeat(44) }],
        ['has characters outside base64url', { token: `${'A'.repeat(42)}=` }],
        ['has surrounding spaces', { token: ` ${'A'.repeat(43)} ` }],
        ['is not a string', { token: 12345 }],
        ['comes with another field', { token: UNKNOWN_TOKEN, email: EMAIL }]
      ])(
        'returns 400 TOKEN_INVALID without querying the database when it %s',
        async (_label, payload) => {
          const findOneAndUpdate = vi.spyOn(
            Collection.prototype,
            'findOneAndUpdate'
          )
          const findOne = vi.spyOn(Collection.prototype, 'findOne')

          const response = await server.inject({
            method: 'POST',
            url: '/email-verifications/verify',
            headers: journeyHeaders(JOURNEY),
            payload
          })

          expect(response.statusCode).toBe(400)
          expect(response.result).toMatchObject({ code: 'TOKEN_INVALID' })
          expect(findOneAndUpdate).not.toHaveBeenCalled()
          expect(findOne).not.toHaveBeenCalled()
        }
      )
    })

    test('refuses a body over 1 KB', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications/verify',
        payload: { token: UNKNOWN_TOKEN, padding: 'x'.repeat(1024) }
      })

      expect(response.statusCode).toBe(413)
    })

    test('returns 404 TOKEN_INVALID for a well-formed token nobody was sent', async () => {
      await sendLink()

      const response = await verify(UNKNOWN_TOKEN)

      expect(response.statusCode).toBe(404)
      expect(response.result).toMatchObject({ code: 'TOKEN_INVALID' })
    })

    test('returns 404 TOKEN_INVALID for a link whose email has not gone yet', async () => {
      const { token, tokenHash } = generateLinkToken()
      await insertSendingRecord(server.db, {
        journeyId: JOURNEY,
        email: EMAIL,
        tokenHash,
        now: START,
        settings: originalSettings
      })

      const response = await verify(token)

      expect(response.statusCode).toBe(404)
      expect(response.result).toMatchObject({ code: 'TOKEN_INVALID' })
      expect((await recordFor(token)).status).toBe('sending')
    })

    test('verifies a link in its last second', async () => {
      const token = await sendLink()
      at(899)

      expect((await verify(token)).statusCode).toBe(200)
    })

    test('returns 410 TOKEN_EXPIRED once the link TTL has passed, and does not verify', async () => {
      const token = await sendLink()
      at(900)

      const response = await verify(token)

      expect(response.statusCode).toBe(410)
      expect(response.result).toMatchObject({ code: 'TOKEN_EXPIRED' })
      expect((await recordFor(token)).status).toBe('pending')
    })

    test('honours a shorter configured link TTL', async () => {
      config.set('emailVerification.linkTtlSeconds', 5)
      const token = await sendLink()
      at(5)

      expect((await verify(token)).result).toMatchObject({
        code: 'TOKEN_EXPIRED'
      })
    })

    test('returns 410 TOKEN_SUPERSEDED for a link replaced by a resend, and the new link verifies', async () => {
      const first = await sendLink()
      at(61)
      const second = await sendLink()

      const response = await verify(first)

      expect(response.statusCode).toBe(410)
      expect(response.result).toMatchObject({ code: 'TOKEN_SUPERSEDED' })
      expect((await recordFor(first)).status).toBe('superseded')
      expect((await verify(second)).statusCode).toBe(200)
    })

    test.each([
      ['the same journey', JOURNEY, true],
      ['another journey', OTHER_JOURNEY, false],
      ['no journey', null, false]
    ])(
      'returns 409 TOKEN_ALREADY_USED for a used link, from %s with sameJourney: %s',
      async (_label, journeyId, sameJourney) => {
        const token = await sendLink()
        await verify(token)
        at(10)

        const response = await verify(token, { journeyId })

        expect(response.statusCode).toBe(409)
        expect(response.result).toMatchObject({
          code: 'TOKEN_ALREADY_USED',
          sameJourney
        })
        expect((await recordFor(token)).verifiedAt).toEqual(START)
      }
    )

    test('returns 500 VERIFICATION_FAILED when the database fails', async () => {
      const token = await sendLink()
      vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockRejectedValueOnce(
        new Error('connection reset')
      )

      const response = await verify(token)

      expect(response.statusCode).toBe(500)
      expect(response.result).toMatchObject({ code: 'VERIFICATION_FAILED' })
    })

    test('returns no email address, token or record id', async () => {
      const token = await sendLink()
      const record = await recordFor(token)

      const responses = [await verify(token), await verify(token)]

      for (const { payload } of responses) {
        expect(payload).not.toContain(EMAIL)
        expect(payload).not.toContain(token)
        expect(payload).not.toContain(record.tokenHash)
        expect(payload).not.toContain(record._id.toString())
        expect(payload).not.toContain(JOURNEY)
      }
    })
  })

  describe('GET /email-verifications/current', () => {
    test('returns none, with no dates, before any link is requested', async () => {
      const response = await current()

      expect(response.statusCode).toBe(200)
      expect(response.result).toEqual({
        status: 'none',
        expiresAt: null,
        verifiedAt: null,
        resendAvailableAt: null
      })
    })

    test('returns pending while the latest link is live', async () => {
      await sendLink()
      at(899)

      expect((await current()).result).toEqual({
        status: 'pending',
        expiresAt: isoAfterStart(900),
        verifiedAt: null,
        resendAvailableAt: isoAfterStart(60)
      })
    })

    test('returns expired once the latest link has passed its expiry', async () => {
      await sendLink()
      at(900)

      expect((await current()).result).toEqual({
        status: 'expired',
        expiresAt: isoAfterStart(900),
        verifiedAt: null,
        resendAvailableAt: isoAfterStart(60)
      })
    })

    test('returns verified once the link is used, even after it would have expired', async () => {
      const token = await sendLink()
      at(30)
      await verify(token)
      at(1000)

      expect((await current()).result).toEqual({
        status: 'verified',
        expiresAt: isoAfterStart(900),
        verifiedAt: isoAfterStart(30),
        resendAvailableAt: isoAfterStart(60)
      })
    })

    test('picks up a verification made from another device', async () => {
      const token = await sendLink()
      await verify(token, { journeyId: null })

      expect((await current()).result).toMatchObject({ status: 'verified' })
    })

    test('stops reporting verified once the verified TTL has passed', async () => {
      const token = await sendLink()
      at(10)
      await verify(token)

      at(10 + 14399)
      expect((await current()).result.status).toBe('verified')
      at(10 + 14400)
      expect((await current()).result).toMatchObject({
        status: 'expired',
        verifiedAt: null
      })
    })

    test('returns pending, not verified, after the address changes', async () => {
      await verify(await sendLink())
      at(61)
      await sendLink({ email: 'new.address@example.com' })

      expect((await current()).result).toMatchObject({
        status: 'pending',
        verifiedAt: null,
        expiresAt: isoAfterStart(961),
        resendAvailableAt: isoAfterStart(121)
      })
    })

    test('stays verified after another link to the same verified address', async () => {
      await verify(await sendLink())
      at(61)
      await sendLink()

      expect((await current()).result).toMatchObject({
        status: 'verified',
        verifiedAt: START.toISOString()
      })
    })

    test('reports the earlier link while a newer one is still being sent', async () => {
      await sendLink()
      at(61)
      await insertSendingRecord(server.db, {
        journeyId: JOURNEY,
        email: 'new.address@example.com',
        tokenHash: generateLinkToken().tokenHash,
        now: secondsAfterStart(61),
        settings: originalSettings
      })

      expect((await current()).result).toMatchObject({
        status: 'pending',
        expiresAt: isoAfterStart(900)
      })
    })

    test('ignores another journey’s links and verifications', async () => {
      await verify(await sendLink({ journeyId: OTHER_JOURNEY }), {
        journeyId: OTHER_JOURNEY
      })

      expect((await current()).result.status).toBe('none')

      await sendLink()
      expect((await current()).result.status).toBe('pending')
    })

    test('returns no email address, token or record id', async () => {
      const token = await sendLink()
      await verify(token)
      const record = await recordFor(token)

      const { payload } = await current()

      expect(payload).not.toContain(EMAIL)
      expect(payload).not.toContain(token)
      expect(payload).not.toContain(record.tokenHash)
      expect(payload).not.toContain(record._id.toString())
    })

    test.each([
      ['missing', {}],
      ['unsigned', { 'x-journey-token': JOURNEY }],
      ['forged', { 'x-journey-token': `${JOURNEY}.${'0'.repeat(64)}` }]
    ])(
      'returns 401 JOURNEY_TOKEN_INVALID when the journey token is %s',
      async (_label, headers) => {
        const response = await current({ headers })

        expect(response.statusCode).toBe(401)
        expect(response.result).toMatchObject({ code: 'JOURNEY_TOKEN_INVALID' })
      }
    )

    test('returns 503 SERVICE_NOT_CONFIGURED when the journey token secret is unset', async () => {
      config.set('journeyToken.secret', '')

      const response = await current()

      expect(response.statusCode).toBe(503)
      expect(response.result).toMatchObject({ code: 'SERVICE_NOT_CONFIGURED' })
    })
  })

  describe('concurrency', () => {
    test('10 parallel verifies of one link give exactly one VERIFIED', async () => {
      const token = await sendLink()

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => verify(token))
      )

      const verified = responses.filter(({ statusCode }) => statusCode === 200)
      expect(verified).toHaveLength(1)
      expect(verified[0].result).toEqual({
        outcome: 'VERIFIED',
        sameJourney: true
      })
      for (const response of responses.filter((r) => r !== verified[0])) {
        expect(response.statusCode).toBe(409)
        expect(response.result).toMatchObject({
          code: 'TOKEN_ALREADY_USED',
          sameJourney: true
        })
      }
      expect(await records.countDocuments({ status: 'verified' })).toBe(1)
    })

    // Whichever lands first, the old link ends up either verified or
    // superseded (never both, never neither), the verify response agrees with
    // it, and the new link is the only live one.
    test('a verify racing a resend leaves a consistent state', async () => {
      for (let i = 0; i < 8; i++) {
        const journeyId = `journey-race-${i}`
        const email = `applicant-${i}@example.com`
        at(0)
        const oldToken = await sendLink({ journeyId, email })
        at(61)

        const [verifyResponse, newToken] = await Promise.all([
          verify(oldToken, { journeyId }),
          sendLink({ journeyId, email })
        ])

        const oldRecord = await recordFor(oldToken)
        if (verifyResponse.statusCode === 200) {
          expect(oldRecord.status).toBe('verified')
          expect(oldRecord.supersededAt).toBeNull()
        } else {
          expect(verifyResponse.statusCode).toBe(410)
          expect(verifyResponse.result).toMatchObject({
            code: 'TOKEN_SUPERSEDED'
          })
          expect(oldRecord.status).toBe('superseded')
          expect(oldRecord.verifiedAt).toBeNull()
        }

        expect((await recordFor(newToken)).status).toBe('pending')
        expect(
          await records.countDocuments({ journeyId, status: 'pending' })
        ).toBe(1)
        expect((await current({ journeyId })).result.status).toBe(
          oldRecord.status === 'verified' ? 'verified' : 'pending'
        )
      }
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

    test('logs no token, token hash or email address for any outcome', async () => {
      const token = await sendLink()
      await current()
      await verify(token, { journeyId: null })
      await verify(token)
      await verify(UNKNOWN_TOKEN)
      await verify(`${token}x`)
      await server.inject({
        method: 'POST',
        url: '/email-verifications/verify',
        payload: { token, email: EMAIL }
      })
      at(61)
      const superseded = await sendLink()
      at(122)
      await sendLink()
      await verify(superseded)
      at(10000)
      await verify(await sendLink())
      vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockRejectedValueOnce(
        new Error('connection reset')
      )
      await verify(token)
      await current()

      const logged = loggedText()
      expect(logger.info).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalled()
      for (const secret of [token, superseded]) {
        expect(logged).not.toContain(secret)
        expect(logged).not.toContain(hashLinkToken(secret))
      }
      expect(logged.toLowerCase()).not.toContain('jane.smith')
    })
  })
})
