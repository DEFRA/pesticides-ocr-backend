import { MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION,
  MONGO_LOCKS_COLLECTION,
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  EMAIL_VERIFICATIONS_COLLECTION,
  EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
} from '#/common/constants/collections.js'
import { HISTORY_VERSION_INDEX } from '#/common/constants/history.js'
import { createAuditedRepository } from '#/repositories/audited-repository.js'

export const mongoDb = {
  plugin: {
    name: 'mongodb',
    version: '1.0.0',
    register: async function (server, options) {
      server.logger.info('Setting up MongoDb')

      const client = await MongoClient.connect(options.mongoUrl, {
        ...options.mongoOptions
      })

      const databaseName = options.databaseName
      const db = client.db(databaseName)
      const locker = new LockManager(db.collection(MONGO_LOCKS_COLLECTION))

      await createIndexes(db)

      server.logger.info(`MongoDb connected to ${databaseName}`)

      server.decorate('server', 'mongoClient', client)
      server.decorate('server', 'db', db)
      server.decorate('server', 'locker', locker)
      server.decorate('request', 'db', () => db, { apply: true })
      server.decorate('request', 'locker', () => locker, { apply: true })

      const registrations = createAuditedRepository({ client, db })
      server.decorate('server', 'registrations', registrations)
      server.decorate('request', 'registrations', () => registrations, {
        apply: true
      })

      server.events.on('stop', async () => {
        server.logger.info('Closing Mongo client')
        try {
          await client.close(true)
        } catch (e) {
          server.logger.error(e, 'failed to close mongo client')
        }
      })
    }
  }
}

async function createIndexes(db) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)

  await db.collection(MONGO_LOCKS_COLLECTION).createIndex({ id: 1 })
  await registrations.createIndex({ reference: 1 }, { unique: true })
  await registrations.createIndex({ submittedAt: -1, reference: 1 })
  try {
    await registrations.dropIndex('submittedAt_1')
  } catch (error) {
    if (error.codeName !== 'IndexNotFound') {
      throw error
    }
  }
  await db
    .collection(OCR_REGISTRATION_HISTORY_COLLECTION)
    .createIndex(HISTORY_VERSION_INDEX.key, HISTORY_VERSION_INDEX.options)
  const journeyStarts = db.collection(JOURNEY_STARTS_COLLECTION)
  const journeyNotEligible = db.collection(JOURNEY_NOT_ELIGIBLE_COLLECTION)

  await journeyStarts.createIndex({ startedAt: 1 })
  await journeyNotEligible.createIndex({ endedAt: 1 })

  // Verified per-session nonce — sparse (only present when the secret is
  // configured) + unique so a replayed nonce for the same event is a no-op.
  await journeyStarts.createIndex({ nonce: 1 }, { unique: true, sparse: true })
  await journeyNotEligible.createIndex(
    { nonce: 1 },
    { unique: true, sparse: true }
  )

  const emailVerifications = db.collection(EMAIL_VERIFICATIONS_COLLECTION)
  const rateLimits = db.collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)

  // Verify looks a link up by its hash.
  await emailVerifications.createIndex({ tokenHash: 1 }, { unique: true })
  // Current status, superseding older links and the /register check all read
  // a journey's records newest first.
  await emailVerifications.createIndex({ journeyId: 1, createdAt: -1 })
  // Mongo deletes each document once the date in the field has passed.
  await emailVerifications.createIndex(
    { purgeAt: 1 },
    { expireAfterSeconds: 0 }
  )
  await rateLimits.createIndex({ windowEndsAt: 1 }, { expireAfterSeconds: 0 })
}
