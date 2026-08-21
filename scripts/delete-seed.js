/**
 * Delete-seed script — removes all seeded registration records from MongoDB.
 * Targets only records whose reference starts with 'SED-'.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/delete-seed.js
 */

import { MongoClient } from 'mongodb'
import { fileURLToPath } from 'url'

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/'
const MONGO_DATABASE = process.env.MONGO_DATABASE ?? 'pesticides-ocr-backend'
export const SEED_PREFIX = 'SED-'

export async function deleteSeed(
  mongoUri = MONGO_URI,
  mongoDatabase = MONGO_DATABASE
) {
  const client = new MongoClient(mongoUri)

  try {
    await client.connect()
    const db = client.db(mongoDatabase)
    const collection = db.collection('ocr-registration')

    const result = await collection.deleteMany({
      reference: { $regex: `^${SEED_PREFIX}` }
    })

    console.log(
      `[delete-seed] Removed ${result.deletedCount} seeded record(s) from '${mongoDatabase}'.`
    )
  } finally {
    await client.close()
  }
}

export async function runCli() {
  await deleteSeed()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error('[delete-seed] Failed:', err.message)
    process.exit(1)
  })
}
