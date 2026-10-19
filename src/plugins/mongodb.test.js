import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import { HISTORY_VERSION_INDEX } from '#/common/constants/history.js'

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
