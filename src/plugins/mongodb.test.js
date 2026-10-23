import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION,
  EMAIL_VERIFICATIONS_COLLECTION,
  EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
} from '#/common/constants/collections.js'
import { HISTORY_VERSION_INDEX } from '#/common/constants/history.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'

describe('#mongoDb', () => {
  let server

  describe('Set up', () => {
    beforeAll(async () => {
      // Dynamic import needed due to config being updated by vitest-mongodb
      const { createServer } = await import('#/server.js')

      server = await createServer()
      await server.initialize()
    })

    test('Server should have expected MongoDb decorators', () => {
      expect(server.db).toBeInstanceOf(Db)
      expect(server.mongoClient).toBeInstanceOf(MongoClient)
      expect(server.locker).toBeInstanceOf(LockManager)
      expect(server.registrations).toEqual(
        expect.objectContaining({
          create: expect.any(Function),
          search: expect.any(Function),
          countByMonth: expect.any(Function)
        })
      )
    })

    test('MongoDb should have expected database name', () => {
      expect(server.db.databaseName).toBe('pesticides-ocr-backend')
    })

    test('MongoDb should have expected namespace', () => {
      expect(server.db.namespace).toBe('pesticides-ocr-backend')
    })

    test('Should create a unique reference + version index on the history', async () => {
      const indexes = await server.db
        .collection(OCR_REGISTRATION_HISTORY_COLLECTION)
        .indexes()

      expect(indexes).toContainEqual(
        expect.objectContaining({
          key: HISTORY_VERSION_INDEX.key,
          ...HISTORY_VERSION_INDEX.options
        })
      )
    })
  })

  describe('Old submittedAt index', () => {
    test('Should drop the old index when two instances start together', async () => {
      const { createServer } = await import('#/server.js')
      const first = await createServer()
      await first.initialize()
      const registrations = first.db.collection(OCR_REGISTRATION_COLLECTION)
      await registrations.createIndex({ submittedAt: 1 })

      const instances = await Promise.all([createServer(), createServer()])
      await Promise.all(instances.map((instance) => instance.initialize()))

      expect(await registrations.indexExists('submittedAt_1')).toBe(false)

      await Promise.all(
        [first, ...instances].map((instance) => instance.stop({ timeout: 0 }))
      )
    })
  })

  describe('Email verification indexes', () => {
    let verifications
    let rateLimits

    // Only the key and the options that change behaviour, so the assertion
    // doesn't depend on fields Mongo adds itself, like v.
    const shape = ({ key, unique, expireAfterSeconds }) => ({
      key,
      ...(unique === undefined ? {} : { unique }),
      ...(expireAfterSeconds === undefined ? {} : { expireAfterSeconds })
    })

    beforeAll(async () => {
      const { createServer } = await import('#/server.js')
      server = await createServer()
      await server.initialize()
      verifications = server.db.collection(EMAIL_VERIFICATIONS_COLLECTION)
      rateLimits = server.db.collection(
        EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
      )
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('creates only the verification indexes that queries use', async () => {
      const indexes = (await verifications.indexes()).map(shape)

      expect(indexes).toEqual([
        { key: { _id: 1 } },
        { key: { tokenHash: 1 }, unique: true },
        { key: { journeyId: 1, createdAt: -1 } },
        { key: { purgeAt: 1 }, expireAfterSeconds: 0 }
      ])
    })

    test('creates a TTL index on the rate-limit window end', async () => {
      const indexes = (await rateLimits.indexes()).map(shape)

      expect(indexes).toEqual([
        { key: { _id: 1 } },
        { key: { windowEndsAt: 1 }, expireAfterSeconds: 0 }
      ])
    })

    test('refuses a second record with the same token hash', async () => {
      const record = () => ({
        journeyId: 'journey-1',
        tokenHash: 'a'.repeat(64),
        status: 'pending'
      })
      await verifications.insertOne(record())

      await expect(verifications.insertOne(record())).rejects.toMatchObject({
        code: MONGO_DUPLICATE_KEY_ERROR
      })
      expect(
        await verifications.countDocuments({ tokenHash: 'a'.repeat(64) })
      ).toBe(1)
    })

    test('lets one of many concurrent inserts with the same token hash win', async () => {
      const tokenHash = 'b'.repeat(64)
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          verifications.insertOne({ journeyId: `journey-${i}`, tokenHash })
        )
      )

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await verifications.countDocuments({ tokenHash })).toBe(1)
    })

    test('creating the indexes again on restart is a no-op', async () => {
      const { createServer } = await import('#/server.js')
      const instances = await Promise.all([createServer(), createServer()])
      await Promise.all(instances.map((instance) => instance.initialize()))

      expect(await verifications.indexes()).toHaveLength(4)
      expect(await rateLimits.indexes()).toHaveLength(2)

      await Promise.all(
        instances.map((instance) => instance.stop({ timeout: 0 }))
      )
    })
  })

  describe('Shut down', () => {
    beforeAll(async () => {
      // Dynamic import needed due to config being updated by vitest-mongodb
      const { createServer } = await import('#/server.js')

      server = await createServer()
      await server.initialize()
    })

    test('Should close Mongo client on server stop', async () => {
      const closeSpy = vi.spyOn(server.mongoClient, 'close')
      await server.stop({ timeout: 1000 })

      expect(closeSpy).toHaveBeenCalledWith(true)
    })
  })
})
