import { randomInt } from 'node:crypto'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'

const logger = createLogger()
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MAX_REFERENCE_RETRIES = 10

export function generateReference(prefix = config.get('referencePrefix')) {
  const segment = () =>
    Array.from({ length: 3 }, () => CHARS[randomInt(CHARS.length)]).join('')
  return `${prefix}-${segment()}-${segment()}`
}

// A duplicate history version also lists reference in its keyPattern, so only
// the registrations' own reference index counts as a collision.
const isReferenceCollision = (err) =>
  err.code === MONGO_DUPLICATE_KEY_ERROR &&
  Object.keys(err.keyPattern ?? {}).join() === 'reference'

// Applicants submit without signing in, so the actor has no id.
const APPLICANT = Object.freeze({ type: ACTOR_TYPE.APPLICANT })

export async function saveRegistration(
  registrations,
  data,
  { prefix, requestId } = {}
) {
  for (let attempt = 1; attempt <= MAX_REFERENCE_RETRIES; attempt++) {
    const reference = generateReference(prefix)
    try {
      await registrations.create(
        { ...data, reference, submittedAt: new Date() },
        { by: APPLICANT, requestId }
      )
      return { reference }
    } catch (err) {
      if (!isReferenceCollision(err)) {
        throw err
      }
      logger.warn({ reference, attempt }, 'Reference collision, retrying')
    }
  }

  throw new Error(
    `Failed to generate a unique reference after ${MAX_REFERENCE_RETRIES} attempts`
  )
}
