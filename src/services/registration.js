import { randomInt } from 'node:crypto'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MONGO_DUPLICATE_KEY_ERROR = 11000
const MAX_REFERENCE_RETRIES = 10

export function generateReference(prefix = config.get('referencePrefix')) {
  const segment = () =>
    Array.from({ length: 3 }, () => CHARS[randomInt(CHARS.length)]).join('')
  return `${prefix}-${segment()}-${segment()}`
}

export async function saveRegistration(db, data, { prefix } = {}) {
  const collection = db.collection('ocr-registration')

  for (let attempt = 1; attempt <= MAX_REFERENCE_RETRIES; attempt++) {
    const reference = generateReference(prefix)
    try {
      const result = await collection.insertOne({
        ...data,
        reference,
        submittedAt: new Date()
      })
      return { ...result, reference }
    } catch (err) {
      if (
        err.code !== MONGO_DUPLICATE_KEY_ERROR ||
        !err.keyPattern?.reference
      ) {
        throw err
      }
      logger.warn({ reference, attempt }, 'Reference collision, retrying')
    }
  }

  throw new Error(
    `Failed to generate a unique reference after ${MAX_REFERENCE_RETRIES} attempts`
  )
}
