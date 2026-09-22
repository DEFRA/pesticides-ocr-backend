import { describe, test, expect, beforeEach, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { hmacHex } from '#/common/helpers/hmac.js'

const { mockGenerateCode, mockSendEmail, mockCheckRateLimit, configValues } =
  vi.hoisted(() => ({
    mockGenerateCode: vi.fn(),
    mockSendEmail: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    configValues: {
      emailVerification: {
        codeLength: 6,
        codeTtlSeconds: 300,
        maxAttempts: 5,
        maxResends: 5,
        resendCooldownSeconds: 60,
        recordTtlSeconds: 86400,
        hashSecret: 'test-secret',
        rateLimit: { maxPerEmailPerHour: 5, maxPerIpPerHour: 20 }
      }
    }
  }))

vi.mock('#/config.js', () => ({
  config: { get: (key) => configValues[key] }
}))
vi.mock('#/services/email-verification/otp.js', () => ({
  generateCode: mockGenerateCode
}))
vi.mock('#/services/notify/notify.js', () => ({ sendEmail: mockSendEmail }))
vi.mock('#/common/helpers/rate-limit.js', () => ({
  checkRateLimit: mockCheckRateLimit
}))

const {
  startVerification,
  confirmVerification,
  resendVerification,
  VerificationNotFoundError,
  CodeExpiredError,
  IncorrectCodeError,
  TooManyAttemptsError,
  AlreadyVerifiedError,
  ResendNotAllowedError,
  RateLimitedError,
  EmailSendError
} = await import('./email-verification.js')

// Minimal in-memory stand-in for the one Mongo collection these functions
// touch, real enough to exercise the actual filter/update logic without a
// real Mongo.
function makeFakeDb() {
  const docs = new Map()

  function applyUpdate(doc, update) {
    if (update.$set) Object.assign(doc, update.$set)
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        doc[key] = (doc[key] ?? 0) + value
      }
    }
    return doc
  }

  const collection = {
    async insertOne(doc) {
      const _id = doc._id ?? new ObjectId()
      docs.set(_id.toString(), { ...doc, _id })
      return { insertedId: _id }
    },
    async findOne(filter) {
      const doc = docs.get(filter._id?.toString())
      return doc ? { ...doc } : null
    },
    async updateOne(filter, update) {
      const doc = docs.get(filter._id.toString())
      if (!doc) {
        return { matchedCount: 0 }
      }
      applyUpdate(doc, update)
      return { matchedCount: 1 }
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.get(filter._id.toString())
      if (!doc) {
        return null
      }
      applyUpdate(doc, update)
      return { ...doc }
    },
    _docs: docs
  }

  return { collection: () => collection, _collection: collection }
}

function insertRecord(db, overrides = {}) {
  const _id = new ObjectId()
  const now = new Date()
  const record = {
    _id,
    email: 'test@example.com',
    codeSalt: 'salt',
    codeHash: hmacHex('test-secret', 'salt:482913'),
    status: 'pending',
    attempts: 0,
    resendCount: 0,
    createdAt: now,
    lastSentAt: new Date(now.getTime() - 120_000),
    otpExpiresAt: new Date(now.getTime() + 300_000),
    verifiedAt: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    ...overrides
  }
  db._collection._docs.set(_id.toString(), { ...record })
  return record
}

beforeEach(() => {
  vi.clearAllMocks()
  configValues.emailVerification.hashSecret = 'test-secret'
  mockCheckRateLimit.mockResolvedValue({ limited: false, count: 1 })
  mockSendEmail.mockResolvedValue({ status: 201 })
  mockGenerateCode.mockReturnValue('482913')
})

describe('startVerification', () => {
  test('creates a pending record and emails the code', async () => {
    const db = makeFakeDb()

    const result = await startVerification(db, {
      email: 'Test@Example.com',
      ip: '1.2.3.4'
    })

    expect(result.email).toBe('test@example.com')
    expect(result.codeLength).toBe(6)
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.resendAllowedAt).toBeInstanceOf(Date)

    expect(mockSendEmail).toHaveBeenCalledWith(
      'emailVerificationOtp',
      'test@example.com',
      { otp: '482913' }
    )

    const stored = db._collection._docs.get(result.verificationId)
    expect(stored.status).toBe('pending')
    expect(stored.codeHash).not.toBe('482913')
  })

  test('throws RateLimitedError when the per-email limit is hit', async () => {
    const db = makeFakeDb()
    mockCheckRateLimit.mockImplementation(async (_db, { key }) => ({
      limited: key.startsWith('email:'),
      count: 99
    }))

    await expect(startVerification(db, { email: 'a@b.com' })).rejects.toThrow(
      RateLimitedError
    )
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  test('throws RateLimitedError when the per-IP limit is hit', async () => {
    const db = makeFakeDb()
    mockCheckRateLimit.mockImplementation(async (_db, { key }) => ({
      limited: key.startsWith('ip:'),
      count: 99
    }))

    await expect(
      startVerification(db, { email: 'a@b.com', ip: '1.2.3.4' })
    ).rejects.toThrow(RateLimitedError)
  })

  test('throws EmailSendError when Notify reports a failed send', async () => {
    const db = makeFakeDb()
    mockSendEmail.mockResolvedValue({ status: 400 })

    await expect(startVerification(db, { email: 'a@b.com' })).rejects.toThrow(
      EmailSendError
    )
  })

  test('throws EmailSendError when Notify rejects', async () => {
    const db = makeFakeDb()
    mockSendEmail.mockRejectedValue(new Error('network error'))

    await expect(startVerification(db, { email: 'a@b.com' })).rejects.toThrow(
      EmailSendError
    )
  })

  test('throws EmailSendError when Notify resolves with an Error (real Notify client behaviour)', async () => {
    const db = makeFakeDb()
    // notify.js's sendEmail() never rejects: it catches Notify API failures
    // and resolves with the caught Error, so that's the shape to guard against.
    mockSendEmail.mockResolvedValue(new Error('Notify API error'))

    await expect(startVerification(db, { email: 'a@b.com' })).rejects.toThrow(
      EmailSendError
    )
  })

  test('throws when no hash secret is configured', async () => {
    configValues.emailVerification.hashSecret = ''
    const db = makeFakeDb()

    await expect(startVerification(db, { email: 'a@b.com' })).rejects.toThrow(
      'No email verification hash secret configured'
    )
  })
})

describe('confirmVerification', () => {
  test('verifies a correct code', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db)

    const result = await confirmVerification(db, {
      verificationId: record._id.toString(),
      code: '482913'
    })

    expect(result).toEqual({ verified: true, email: 'test@example.com' })

    const stored = db._collection._docs.get(record._id.toString())
    expect(stored.status).toBe('verified')
    expect(stored.verifiedAt).toBeInstanceOf(Date)
  })

  test('is idempotent once already verified — no code re-check needed', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { status: 'verified' })

    const result = await confirmVerification(db, {
      verificationId: record._id.toString(),
      code: 'wrong'
    })

    expect(result).toEqual({ verified: true, email: 'test@example.com' })
  })

  test('increments attempts and throws on an incorrect code', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db)

    await expect(
      confirmVerification(db, {
        verificationId: record._id.toString(),
        code: '000000'
      })
    ).rejects.toThrow(IncorrectCodeError)

    expect(db._collection._docs.get(record._id.toString()).attempts).toBe(1)
  })

  test('reports remaining attempts on the thrown error', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db)

    await expect(
      confirmVerification(db, {
        verificationId: record._id.toString(),
        code: '000000'
      })
    ).rejects.toMatchObject({ remainingAttempts: 4 })
  })

  test('throws CodeExpiredError once the code has expired', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, {
      otpExpiresAt: new Date(Date.now() - 1000)
    })

    await expect(
      confirmVerification(db, {
        verificationId: record._id.toString(),
        code: '482913'
      })
    ).rejects.toThrow(CodeExpiredError)
  })

  test('throws TooManyAttemptsError once attempts reach the limit', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { attempts: 5 })

    await expect(
      confirmVerification(db, {
        verificationId: record._id.toString(),
        code: '482913'
      })
    ).rejects.toThrow(TooManyAttemptsError)
  })

  test('throws VerificationNotFoundError for an unknown id', async () => {
    const db = makeFakeDb()

    await expect(
      confirmVerification(db, {
        verificationId: new ObjectId().toString(),
        code: '482913'
      })
    ).rejects.toThrow(VerificationNotFoundError)
  })

  test('throws VerificationNotFoundError for a malformed id', async () => {
    const db = makeFakeDb()

    await expect(
      confirmVerification(db, { verificationId: 'not-an-id', code: '482913' })
    ).rejects.toThrow(VerificationNotFoundError)
  })
})

describe('resendVerification', () => {
  test('issues a new code, resets attempts and increments resendCount', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { attempts: 3 })
    mockGenerateCode.mockReturnValue('111111')

    const result = await resendVerification(db, {
      verificationId: record._id.toString()
    })

    expect(result.verificationId).toBe(record._id.toString())
    expect(mockSendEmail).toHaveBeenCalledWith(
      'emailVerificationOtp',
      'test@example.com',
      { otp: '111111' }
    )

    const stored = db._collection._docs.get(record._id.toString())
    expect(stored.attempts).toBe(0)
    expect(stored.resendCount).toBe(1)
    expect(stored.codeHash).not.toBe(record.codeHash)
  })

  test('throws ResendNotAllowedError within the cooldown window', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { lastSentAt: new Date() })

    await expect(
      resendVerification(db, { verificationId: record._id.toString() })
    ).rejects.toThrow(ResendNotAllowedError)
  })

  test('throws ResendNotAllowedError once maxResends is reached', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { resendCount: 5 })

    await expect(
      resendVerification(db, { verificationId: record._id.toString() })
    ).rejects.toThrow(ResendNotAllowedError)
  })

  test('throws AlreadyVerifiedError once the email is already verified', async () => {
    const db = makeFakeDb()
    const record = insertRecord(db, { status: 'verified' })

    await expect(
      resendVerification(db, { verificationId: record._id.toString() })
    ).rejects.toThrow(AlreadyVerifiedError)
  })
})
