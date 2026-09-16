import { MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION
} from '#/services/metrics/metrics.js'

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
      const locker = new LockManager(db.collection('mongo-locks'))

      await createIndexes(db)

      server.logger.info(`MongoDb connected to ${databaseName}`)

      server.decorate('server', 'mongoClient', client)
      server.decorate('server', 'db', db)
      server.decorate('server', 'locker', locker)
      server.decorate('request', 'db', () => db, { apply: true })
      server.decorate('request', 'locker', () => locker, { apply: true })

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

  await db.collection('mongo-locks').createIndex({ id: 1 })
  await registrations.createIndex({ submittedAt: 1 })
  await registrations.createIndex({ reference: 1 }, { unique: true })
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
}
