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
import {
  EMAIL_VERIFICATION_LINK_REQUESTED,
  EMAIL_VERIFICATION_LINK_SEND_FAILED,
  EMAIL_VERIFICATION_LINK_SENT,
  EMAIL_VERIFICATION_RATE_LIMITED,
  EMAIL_VERIFICATION_REJECTED,
  EMAIL_VERIFICATION_VERIFIED
} from '#/common/constants/audit-events.js'
import {
  networkErrorMock,
  notifyRejectionMock,
  successfulSendEmailMock
} from '#/services/notify/notify.fixtures.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'
import { hashLinkToken } from '#/services/email-verification/link-token.js'
import { METRICS } from '#/services/email-verification/metrics.js'

const JOURNEY_SECRET = 'journey-test-secret'
const HASH_SECRET = 'hash-test-secret'
const LINK_BASE_URL = 'https://ocr.example.gov.uk'

// notify.js reads its config when first imported, so the settings it needs
// must be in place before anything imports it.
const { mockSendEmail, mockAudit, mockCounter, testEnv } = vi.hoisted(() => {
  const env = {
    JOURNEY_TOKEN_SECRET: 'journey-test-secret',
    EMAIL_VERIFICATION_HASH_SECRET: 'hash-test-secret',
    EMAIL_VERIFICATION_LINK_BASE_URL: 'https://ocr.example.gov.uk',
    NOTIFY_API_KEY: 'notify-test-key',
    NOTIFY_TEMPLATE_EMAIL_VERIFICATION_LINK: 'email-verification-template-id'
  }
  Object.assign(process.env, env)
  return {
    mockSendEmail: vi.fn(),
    mockAudit: vi.fn(),
    mockCounter: vi.fn(),
    testEnv: env
  }
})

vi.mock('notifications-node-client', () => ({
  NotifyClient: vi.fn(function () {
    return { sendEmail: mockSendEmail }
  })
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

const journeyToken = (nonce) =>
  `${nonce}.${createHmac('sha256', JOURNEY_SECRET).update(nonce).digest('hex')}`

const JOURNEY = 'journey-0f2b8c1e-7a4d-4e9b-9c6f-1d2e3f4a5b6c'
const OTHER_JOURNEY = 'journey-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const EMAIL = 'jane.smith@example.com'
const EMAIL_HASH = hashEmail(EMAIL, HASH_SECRET)
const UNKNOWN_TOKEN = 'A'.repeat(43)

describe('email verification: audit events and metrics', () => {
  let server
  let config
  let records
  let rateLimits
  let originalSettings

  beforeAll(async () => {
    // Imported here so config reads the in-memory MONGO_URI.
    const [{ createServer }, configModule] = await Promise.all([
      import('#/server.js'),
      import('#/config.js')
    ])
    config = configModule.config
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
    mockAudit.mockReset()
    mockCounter.mockReset().mockResolvedValue(undefined)
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

  const at = (seconds) => vi.setSystemTime(secondsAfterStart(seconds))
  const journeyHeaders = (journeyId) =>
    journeyId ? { 'x-journey-token': journeyToken(journeyId) } : {}

  const requestLink = ({ journeyId = JOURNEY, email = EMAIL } = {}) =>
    server.inject({
      method: 'POST',
      url: '/email-verifications',
      headers: journeyHeaders(journeyId),
      payload: { email }
    })

  const sentToken = () =>
    new URL(
      mockSendEmail.mock.lastCall[2].personalisation.verification_link
    ).searchParams.get('token')

  const sendLink = async (options) => {
    expect((await requestLink(options)).statusCode).toBe(202)
    return sentToken()
  }

  const verify = (token, { journeyId = JOURNEY } = {}) =>
    server.inject({
      method: 'POST',
      url: '/email-verifications/verify',
      headers: journeyHeaders(journeyId),
      payload: { token }
    })

  const auditedEvents = () => mockAudit.mock.calls.map(([data]) => data)
  const audited = (event) =>
    auditedEvents().filter((data) => data.event === event)
  const counted = (name) =>
    mockCounter.mock.calls
      .filter(([metric]) => metric === name)
      .map(([, value, dimensions]) => ({ value, dimensions }))

  // Leaves only what the next request emits.
  const clearRecorded = () => {
    mockAudit.mockClear()
    mockCounter.mockClear()
  }

  describe('requesting a link', () => {
    test('audits the request and the send, and counts the send', async () => {
      await requestLink()

      expect(auditedEvents()).toEqual([
        {
          event: EMAIL_VERIFICATION_LINK_REQUESTED,
          journeyId: JOURNEY,
          emailHash: EMAIL_HASH
        },
        {
          event: EMAIL_VERIFICATION_LINK_SENT,
          journeyId: JOURNEY,
          emailHash: EMAIL_HASH,
          expiresAt: '2030-01-01T10:15:00.000Z'
        }
      ])
      expect(mockAudit).toHaveBeenCalledWith(
        expect.any(Object),
        EMAIL_VERIFICATION_LINK_SENT
      )
      expect(counted(METRICS.LINK_SENT)).toEqual([{ value: 1, dimensions: {} }])
    })

    test('hashes the normalised address', async () => {
      await requestLink({ email: '  Jane.Smith@Example.COM ' })

      expect(audited(EMAIL_VERIFICATION_LINK_SENT)[0].emailHash).toBe(
        EMAIL_HASH
      )
    })

    test.each([
      ['Notify refuses the email', notifyRejectionMock, 'BadRequestError'],
      [
        'Notify is unreachable',
        () => Object.assign(networkErrorMock(), { code: 'ECONNREFUSED' }),
        'ECONNREFUSED'
      ],
      ['the failure has no type or code', networkErrorMock, 'UNKNOWN']
    ])(
      'audits and counts a failed send when %s, with only its category',
      async (_label, failure, reason) => {
        mockSendEmail.mockRejectedValueOnce(failure())

        await requestLink()

        expect(audited(EMAIL_VERIFICATION_LINK_SEND_FAILED)).toEqual([
          {
            event: EMAIL_VERIFICATION_LINK_SEND_FAILED,
            journeyId: JOURNEY,
            emailHash: EMAIL_HASH,
            reason
          }
        ])
        expect(audited(EMAIL_VERIFICATION_LINK_SENT)).toEqual([])
        expect(counted(METRICS.SEND_FAILED)).toEqual([
          { value: 1, dimensions: {} }
        ])
        expect(counted(METRICS.LINK_SENT)).toEqual([])
      }
    )

    test('does not audit a database failure as a failed send', async () => {
      vi.spyOn(Collection.prototype, 'insertOne').mockRejectedValueOnce(
        new Error('Mongo down')
      )

      expect((await requestLink()).statusCode).toBe(500)
      expect(audited(EMAIL_VERIFICATION_LINK_SEND_FAILED)).toEqual([])
    })
  })

  describe('rate limiting', () => {
    const expectLimited = (response, limit, { journeyId, email = EMAIL }) => {
      expect(response.statusCode).toBe(429)
      expect(audited(EMAIL_VERIFICATION_RATE_LIMITED)).toEqual([
        {
          event: EMAIL_VERIFICATION_RATE_LIMITED,
          journeyId,
          emailHash: hashEmail(email, HASH_SECRET),
          limit
        }
      ])
      expect(counted(METRICS.RATE_LIMITED)).toEqual([
        { value: 1, dimensions: { limit } }
      ])
      expect(audited(EMAIL_VERIFICATION_LINK_SENT)).toEqual([])
    }

    test('records the cooldown', async () => {
      await requestLink()
      clearRecorded()

      const response = await requestLink()

      expectLimited(response, 'cooldown', { journeyId: JOURNEY })
      expect(response.result).toMatchObject({ code: 'RESEND_COOLDOWN' })
    })

    test('records the per-address cap', async () => {
      for (let i = 0; i < 5; i++) {
        await requestLink({ journeyId: `journey-${i}` })
      }
      clearRecorded()

      const response = await requestLink({ journeyId: 'journey-5' })

      expectLimited(response, 'email', { journeyId: 'journey-5' })
      expect(response.result).toMatchObject({ code: 'RATE_LIMITED' })
    })

    test('records the per-journey cap', async () => {
      for (let i = 0; i < 5; i++) {
        at(i * 60)
        await requestLink({ email: `applicant-${i}@example.com` })
      }
      at(1800)
      clearRecorded()

      const response = await requestLink({ email: 'applicant-5@example.com' })

      expectLimited(response, 'journey', {
        journeyId: JOURNEY,
        email: 'applicant-5@example.com'
      })
      expect(response.result).toMatchObject({ code: 'RATE_LIMITED' })
    })

    test('records the global cap', async () => {
      config.set('emailVerification.maxSendsGlobalPerHour', 1)
      await requestLink({ journeyId: 'journey-1', email: 'one@example.com' })
      clearRecorded()

      const response = await requestLink({
        journeyId: 'journey-2',
        email: 'two@example.com'
      })

      expectLimited(response, 'global', {
        journeyId: 'journey-2',
        email: 'two@example.com'
      })
      expect(response.result).toMatchObject({ code: 'RATE_LIMITED' })
    })
  })

  describe('verifying a link', () => {
    test.each([
      ['the journey that asked', JOURNEY, true],
      ['another journey', OTHER_JOURNEY, false],
      ['a browser with no journey', null, false]
    ])(
      'audits and counts a verification from %s',
      async (_label, journeyId, sameJourney) => {
        const token = await sendLink()
        clearRecorded()

        await verify(token, { journeyId })

        expect(auditedEvents()).toEqual([
          {
            event: EMAIL_VERIFICATION_VERIFIED,
            journeyId: JOURNEY,
            emailHash: EMAIL_HASH,
            sameJourney
          }
        ])
        expect(counted(METRICS.VERIFIED)).toEqual([
          { value: 1, dimensions: {} }
        ])
      }
    )

    const expectRejected = (code, { journeyId, emailHash }) => {
      expect(auditedEvents()).toEqual([
        {
          event: EMAIL_VERIFICATION_REJECTED,
          ...(journeyId ? { journeyId } : {}),
          ...(emailHash ? { emailHash } : {}),
          code
        }
      ])
      expect(counted(METRICS.REJECTED)).toEqual([
        { value: 1, dimensions: { outcome: code } }
      ])
      expect(counted(METRICS.VERIFIED)).toEqual([])
    }

    test('records an expired link', async () => {
      const token = await sendLink()
      at(901)
      clearRecorded()

      expect((await verify(token)).statusCode).toBe(410)
      expectRejected('TOKEN_EXPIRED', {
        journeyId: JOURNEY,
        emailHash: EMAIL_HASH
      })
    })

    test('records a superseded link', async () => {
      const first = await sendLink()
      at(61)
      await sendLink()
      clearRecorded()

      expect((await verify(first)).statusCode).toBe(410)
      expectRejected('TOKEN_SUPERSEDED', {
        journeyId: JOURNEY,
        emailHash: EMAIL_HASH
      })
    })

    test('records a link used twice', async () => {
      const token = await sendLink()
      await verify(token)
      clearRecorded()

      expect((await verify(token)).statusCode).toBe(409)
      expectRejected('TOKEN_ALREADY_USED', {
        journeyId: JOURNEY,
        emailHash: EMAIL_HASH
      })
    })

    test('records an unknown token against the caller’s journey', async () => {
      expect((await verify(UNKNOWN_TOKEN)).statusCode).toBe(404)
      expectRejected('TOKEN_INVALID', { journeyId: JOURNEY })
    })

    test('records an unknown token with no journey', async () => {
      expect(
        (await verify(UNKNOWN_TOKEN, { journeyId: null })).statusCode
      ).toBe(404)
      expectRejected('TOKEN_INVALID', {})
    })

    test('records a malformed token', async () => {
      expect((await verify('not-a-token')).statusCode).toBe(400)
      expectRejected('TOKEN_INVALID', { journeyId: JOURNEY })
    })
  })

  describe('when auditing or metrics fail', () => {
    // Every outcome, with its status, so a failure in either can be shown to
    // change none of them.
    const allOutcomes = async () => {
      const statuses = []
      const record = async (response) => statuses.push(response.statusCode)

      await record(await requestLink())
      const token = sentToken()
      await record(await requestLink())
      await record(await verify(token))
      await record(await verify(token))
      await record(await verify(UNKNOWN_TOKEN))
      await record(await verify('not-a-token'))
      at(61)
      mockSendEmail.mockRejectedValueOnce(notifyRejectionMock())
      await record(await requestLink())
      return statuses
    }

    const EXPECTED = [202, 429, 200, 409, 404, 400, 502]

    test('responds the same when every audit write throws', async () => {
      mockAudit.mockImplementation(() => {
        throw new Error('audit stream unavailable')
      })

      expect(await allOutcomes()).toEqual(EXPECTED)
    })

    test('responds the same when every metric fails', async () => {
      mockCounter.mockRejectedValue(new Error('EMF flush failed'))

      expect(await allOutcomes()).toEqual(EXPECTED)
    })

    test('responds the same when every metric throws', async () => {
      mockCounter.mockImplementation(() => {
        throw new Error('EMF unavailable')
      })

      expect(await allOutcomes()).toEqual(EXPECTED)
    })
  })

  test('no audit event or metric holds a token, token hash, link or address', async () => {
    const first = await sendLink({ email: '  Jane.Smith@Example.COM ' })
    await requestLink()
    at(61)
    const second = await sendLink()
    await verify(first)
    await verify(second)
    await verify(second)
    await verify(UNKNOWN_TOKEN)
    at(122)
    mockSendEmail.mockRejectedValueOnce(notifyRejectionMock())
    await requestLink()

    const emitted = JSON.stringify([
      mockAudit.mock.calls,
      mockCounter.mock.calls
    ])
    expect(auditedEvents().length).toBeGreaterThan(0)
    for (const token of [first, second]) {
      expect(emitted).not.toContain(token)
      expect(emitted).not.toContain(hashLinkToken(token))
    }
    expect(emitted).not.toContain(LINK_BASE_URL)
    expect(emitted).not.toContain('verify-email')
    expect(emitted.toLowerCase()).not.toContain('jane.smith')
    expect(emitted).not.toContain('a.b@defra.gov.uk')
    expect(emitted).not.toContain('team-only API key')
  })
})
