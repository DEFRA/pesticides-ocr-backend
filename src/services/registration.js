import { randomInt } from 'crypto'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MONGO_DUPLICATE_KEY_ERROR = 11000

function generateReference() {
  const segment = () =>
    Array.from({ length: 3 }, () => CHARS[randomInt(CHARS.length)]).join('')
  return `PP-${segment()}-${segment()}`
}

export async function saveRegistration(db, data) {
  const collection = db.collection('ocr-registration')

  while (true) {
    const reference = generateReference()
    try {
      const result = await collection.insertOne({
        ...data,
        reference,
        submittedAt: new Date()
      })
      return { ...result, reference }
    } catch (err) {
      if (err.code !== MONGO_DUPLICATE_KEY_ERROR) {
        throw err
      }
    }
  }
}
