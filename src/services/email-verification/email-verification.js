import { ObjectId } from 'mongodb'
import { config } from '#/config.js'
import { hmacHex, hmacHexEquals, randomHex } from '#/common/helpers/hmac.js'
import { checkRateLimit } from '#/common/helpers/rate-limit.js'
import { sendEmail } from '#/services/notify/notify.js'
import { generateCode } from '#/services/email-verification/otp.js'

export const COLLECTION = 'email-verifications'
export const RATE_LIMIT_COLLECTION = 'email-verification-rate-limits'

const MS_PER_SECOND = 1000
const SECONDS_PER_HOUR = 3600
const NOTIFY_ERROR_STATUS_THRESHOLD = 400

// This is a frontend-only gate: these endpoints drive the OTP step in the
// UI, but POST /register is not checked against them (see
// docs/email-verification-design.md, "Decision: frontend-only gate"). There
// is deliberately no token or submission-linking concept here.

export class VerificationNotFoundError extends Error {}
export class CodeExpiredError extends Error {}
export class IncorrectCodeError extends Error {
  constructor(message, { remainingAttempts }) {
    super(message)
    this.remainingAttempts = remainingAttempts
  }
}

export class TooManyAttemptsError extends Error {}
export class AlreadyVerifiedError extends Error {}
export class ResendNotAllowedError extends Error {
  constructor(message, { retryAfter }) {
    super(message)
    this.retryAfter = retryAfter
  }
}

export class RateLimitedError extends Error {}
export class EmailSendError extends Error {}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function getHashSecret() {
  const secret = config.get('emailVerification').hashSecret
  if (!secret) {
    throw new Error('No email verification hash secret configured')
  }
  return secret
}

async function enforceStartRateLimit(db, { email, ip }) {
  const { rateLimit } = config.get('emailVerification')

  const emailCheck = await checkRateLimit(db, {
    collection: RATE_LIMIT_COLLECTION,
    key: `email:${email}`,
    windowSeconds: SECONDS_PER_HOUR,
    max: rateLimit.maxPerEmailPerHour
  })
  if (emailCheck.limited) {
    throw new RateLimitedError(
      'Too many verification requests for this email address. Try again later.'
    )
  }

  if (ip) {
    const ipCheck = await checkRateLimit(db, {
      collection: RATE_LIMIT_COLLECTION,
      key: `ip:${ip}`,
      windowSeconds: SECONDS_PER_HOUR,
      max: rateLimit.maxPerIpPerHour
    })
    if (ipCheck.limited) {
      throw new RateLimitedError(
        'Too many verification requests. Try again later.'
      )
    }
  }
}

async function dispatchCode(email, code) {
  let response
  try {
    // The Notify template references the code as ((otp)), so the
    // personalisation key must be `otp` — not `code`.
    response = await sendEmail('emailVerificationOtp', email, { otp: code })
  } catch (err) {
    throw new EmailSendError(err.message)
  }

  if (response?.status >= NOTIFY_ERROR_STATUS_THRESHOLD) {
    throw new EmailSendError('Failed to send verification email')
  }
}

function buildStartResult(record) {
  return {
    verificationId: record._id.toString(),
    email: record.email,
    codeLength: config.get('emailVerification').codeLength,
    expiresAt: record.otpExpiresAt,
    resendAllowedAt: new Date(
      record.lastSentAt.getTime() +
        config.get('emailVerification').resendCooldownSeconds * MS_PER_SECOND
    )
  }
}

export async function startVerification(db, { email, ip }) {
  const normalizedEmail = normalizeEmail(email)
  await enforceStartRateLimit(db, { email: normalizedEmail, ip })

  const { codeLength, codeTtlSeconds, recordTtlSeconds } =
    config.get('emailVerification')
  const secret = getHashSecret()

  const code = generateCode(codeLength)
  const codeSalt = randomHex(16)
  const codeHash = hmacHex(secret, `${codeSalt}:${code}`)

  const now = new Date()
  const record = {
    email: normalizedEmail,
    codeSalt,
    codeHash,
    status: 'pending',
    attempts: 0,
    resendCount: 0,
    createdAt: now,
    lastSentAt: now,
    otpExpiresAt: new Date(now.getTime() + codeTtlSeconds * MS_PER_SECOND),
    verifiedAt: null,
    expiresAt: new Date(now.getTime() + recordTtlSeconds * MS_PER_SECOND)
  }

  const { insertedId } = await db.collection(COLLECTION).insertOne(record)
  await dispatchCode(normalizedEmail, code)

  return buildStartResult({ ...record, _id: insertedId })
}

function toObjectId(verificationId) {
  try {
    return new ObjectId(verificationId)
  } catch {
    return null
  }
}

async function findVerification(db, verificationId) {
  const _id = toObjectId(verificationId)
  if (!_id) {
    throw new VerificationNotFoundError('Verification not found or expired')
  }

  const record = await db.collection(COLLECTION).findOne({ _id })
  if (!record) {
    throw new VerificationNotFoundError('Verification not found or expired')
  }
  return record
}

export async function confirmVerification(db, { verificationId, code }) {
  const record = await findVerification(db, verificationId)

  // Idempotent: once verified, re-confirming (double form-submit, back/
  // forward navigation) just succeeds again without re-checking the code.
  if (record.status === 'verified') {
    return { verified: true, email: record.email }
  }

  const { maxAttempts } = config.get('emailVerification')
  const secret = getHashSecret()

  const now = new Date()
  if (now > record.otpExpiresAt) {
    throw new CodeExpiredError('Code has expired. Request a new one.')
  }

  if (record.attempts >= maxAttempts) {
    throw new TooManyAttemptsError(
      'Too many incorrect attempts. Request a new code.'
    )
  }

  const isCorrect = hmacHexEquals(
    secret,
    `${record.codeSalt}:${code}`,
    record.codeHash
  )

  if (!isCorrect) {
    const attempts = record.attempts + 1
    await db
      .collection(COLLECTION)
      .updateOne({ _id: record._id }, { $set: { attempts } })
    throw new IncorrectCodeError('Incorrect code', {
      remainingAttempts: Math.max(maxAttempts - attempts, 0)
    })
  }

  await db
    .collection(COLLECTION)
    .updateOne(
      { _id: record._id },
      { $set: { status: 'verified', verifiedAt: now, attempts: 0 } }
    )

  return { verified: true, email: record.email }
}

export async function resendVerification(db, { verificationId, ip }) {
  const record = await findVerification(db, verificationId)
  const { codeLength, codeTtlSeconds, maxResends, resendCooldownSeconds } =
    config.get('emailVerification')

  if (record.status === 'verified') {
    throw new AlreadyVerifiedError('This email address is already verified')
  }

  const now = new Date()
  const cooldownEnds = new Date(
    record.lastSentAt.getTime() + resendCooldownSeconds * MS_PER_SECOND
  )
  if (now < cooldownEnds) {
    throw new ResendNotAllowedError(
      'Please wait before requesting another code',
      { retryAfter: cooldownEnds }
    )
  }

  if (record.resendCount >= maxResends) {
    throw new ResendNotAllowedError(
      'Maximum resend attempts reached. Start a new verification.',
      { retryAfter: null }
    )
  }

  await enforceStartRateLimit(db, { email: record.email, ip })

  const secret = getHashSecret()
  const code = generateCode(codeLength)
  const codeSalt = randomHex(16)
  const codeHash = hmacHex(secret, `${codeSalt}:${code}`)
  const otpExpiresAt = new Date(now.getTime() + codeTtlSeconds * MS_PER_SECOND)

  const updated = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: record._id },
    {
      $set: {
        codeSalt,
        codeHash,
        otpExpiresAt,
        attempts: 0,
        lastSentAt: now
      },
      $inc: { resendCount: 1 }
    },
    { returnDocument: 'after' }
  )

  await dispatchCode(record.email, code)

  return buildStartResult(updated)
}
