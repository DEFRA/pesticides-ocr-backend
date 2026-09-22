import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'

const mockStart = vi.fn()
const mockConfirm = vi.fn()
const mockResend = vi.fn()

vi.mock(
  '#/services/email-verification/email-verification.js',
  async (importOriginal) => {
    const actual = await importOriginal()
    return {
      ...actual,
      startVerification: mockStart,
      confirmVerification: mockConfirm,
      resendVerification: mockResend
    }
  }
)

// These are imported inside beforeAll, not at module scope: importing the
// service module here (even indirectly via importOriginal in the vi.mock
// above) pulls in #/config.js, which freezes mongoUrl from process.env at
// that instant. Doing this before the mongo-memory-server setup file's
// beforeAll has set MONGO_URI locks the config to the default
// 127.0.0.1:27017 for the rest of this file's module lifetime.
let VerificationNotFoundError,
  CodeExpiredError,
  IncorrectCodeError,
  TooManyAttemptsError,
  AlreadyVerifiedError,
  ResendNotAllowedError,
  RateLimitedError,
  EmailSendError

describe('email verification routes', () => {
  let server
  const VALID_ID = '507f1f77bcf86cd799439011'

  beforeAll(async () => {
    ;({
      VerificationNotFoundError,
      CodeExpiredError,
      IncorrectCodeError,
      TooManyAttemptsError,
      AlreadyVerifiedError,
      ResendNotAllowedError,
      RateLimitedError,
      EmailSendError
    } = await import('#/services/email-verification/email-verification.js'))

    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 1000 })
  })

  describe('POST /email-verifications', () => {
    test('returns 201 with the service result on success', async () => {
      mockStart.mockResolvedValue({
        verificationId: VALID_ID,
        email: 'a@b.com',
        codeLength: 6,
        expiresAt: new Date().toISOString(),
        resendAllowedAt: new Date().toISOString()
      })

      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications',
        payload: { email: 'a@b.com' }
      })

      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.payload).verificationId).toBe(VALID_ID)
      expect(mockStart).toHaveBeenCalledWith(expect.anything(), {
        email: 'a@b.com',
        ip: expect.any(String)
      })
    })

    test('returns 400 for an invalid email address', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications',
        payload: { email: 'not-an-email' }
      })

      expect(response.statusCode).toBe(400)
      expect(mockStart).not.toHaveBeenCalled()
    })

    test('returns 429 when rate limited', async () => {
      mockStart.mockRejectedValue(new RateLimitedError('Too many requests'))

      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications',
        payload: { email: 'a@b.com' }
      })

      expect(response.statusCode).toBe(429)
    })

    test('returns 502 when the email fails to send', async () => {
      mockStart.mockRejectedValue(new EmailSendError('send failed'))

      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications',
        payload: { email: 'a@b.com' }
      })

      expect(response.statusCode).toBe(502)
    })

    test('returns 500 for an unmapped error', async () => {
      mockStart.mockRejectedValue(new Error('boom'))

      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications',
        payload: { email: 'a@b.com' }
      })

      expect(response.statusCode).toBe(500)
    })
  })

  describe('POST /email-verifications/{verificationId}/confirm', () => {
    test('returns 200 with the service result on success', async () => {
      mockConfirm.mockResolvedValue({ verified: true, email: 'a@b.com' })

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.payload).verified).toBe(true)
      expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), {
        verificationId: VALID_ID,
        code: '482913'
      })
    })

    test('returns 400 for a malformed verificationId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/email-verifications/not-a-valid-id/confirm',
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when the code is the wrong length', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '123' }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 404 when the verification is not found', async () => {
      mockConfirm.mockRejectedValue(new VerificationNotFoundError('gone'))

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(404)
    })

    test('returns 400 when the code has expired', async () => {
      mockConfirm.mockRejectedValue(new CodeExpiredError('expired'))

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 with remainingAttempts for an incorrect code', async () => {
      mockConfirm.mockRejectedValue(
        new IncorrectCodeError('wrong', { remainingAttempts: 3 })
      )

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).remainingAttempts).toBe(3)
    })

    test('returns 429 once attempts are exhausted', async () => {
      mockConfirm.mockRejectedValue(new TooManyAttemptsError('too many'))

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/confirm`,
        payload: { code: '482913' }
      })

      expect(response.statusCode).toBe(429)
    })
  })

  describe('POST /email-verifications/{verificationId}/resend', () => {
    test('returns 201 with the service result on success', async () => {
      mockResend.mockResolvedValue({
        verificationId: VALID_ID,
        email: 'a@b.com',
        codeLength: 6,
        expiresAt: new Date().toISOString(),
        resendAllowedAt: new Date().toISOString()
      })

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/resend`
      })

      expect(response.statusCode).toBe(201)
      expect(mockResend).toHaveBeenCalledWith(expect.anything(), {
        verificationId: VALID_ID,
        ip: expect.any(String)
      })
    })

    test('returns 409 when already verified', async () => {
      mockResend.mockRejectedValue(new AlreadyVerifiedError('done'))

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/resend`
      })

      expect(response.statusCode).toBe(409)
    })

    test('returns 429 with retryAfter within the cooldown window', async () => {
      const retryAfter = new Date()
      mockResend.mockRejectedValue(
        new ResendNotAllowedError('wait', { retryAfter })
      )

      const response = await server.inject({
        method: 'POST',
        url: `/email-verifications/${VALID_ID}/resend`
      })

      expect(response.statusCode).toBe(429)
      expect(JSON.parse(response.payload).retryAfter).toBe(
        retryAfter.toISOString()
      )
    })
  })
})
