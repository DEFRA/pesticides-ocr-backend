import { MongoClient } from 'mongodb'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { createAuditedRepository } from './audited-repository.js'

const caseOfficer = { type: ACTOR_TYPE.CASE_OFFICER, id: 'officer-1' }

describe('#createAuditedRepository', () => {
  let client
  let db
  let collection
  let repository

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('audited-repository-test')
    collection = db.collection(OCR_REGISTRATION_COLLECTION)
    repository = createAuditedRepository({ client, db })
  })

  beforeEach(async () => {
    await db.dropDatabase()
    await collection.createIndex({ reference: 1 }, { unique: true })
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  const stored = (reference) =>
    collection.findOne({ reference }, { projection: { _id: 0 } })

  describe('create', () => {
    test('stores the registration as not deleted', async () => {
      const registration = { reference: 'PPP-AAA-001', businessName: 'Acme' }

      const created = await repository.create(registration)

      expect(created).toEqual({ ...registration, isDeleted: false })
      expect(await stored('PPP-AAA-001')).toEqual(created)
      expect(registration).not.toHaveProperty('_id')
    })

    test('stores the submittedAt it is given', async () => {
      const submittedAt = new Date('2026-10-01T09:00:00Z')

      await repository.create({ reference: 'PPP-AAA-001', submittedAt })

      expect(await stored('PPP-AAA-001')).toMatchObject({ submittedAt })
    })

    test('rejects lifecycle fields', async () => {
      await expect(
        repository.create({ reference: 'PPP-AAA-001', isDeleted: true })
      ).rejects.toThrow('Cannot set protected fields: isDeleted')
    })

    test('rejects a dotted path into a lifecycle field', async () => {
      await expect(
        repository.create({ reference: 'PPP-AAA-001', 'deletedBy.type': 'x' })
      ).rejects.toThrow('Cannot set protected fields: deletedBy.type')
    })

    test.each([undefined, { $gt: '' }])(
      'rejects a reference of %s',
      async (reference) => {
        await expect(repository.create({ reference })).rejects.toThrow(
          'reference must be a string'
        )
      }
    )

    test('rethrows a duplicate reference error', async () => {
      await repository.create({ reference: 'PPP-AAA-001' })

      await expect(
        repository.create({ reference: 'PPP-AAA-001' })
      ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })
    })
  })

  describe('reads', () => {
    beforeEach(async () => {
      await repository.create({ reference: 'PPP-AAA-001', businessName: 'A' })
      await repository.create({ reference: 'PPP-AAA-002', businessName: 'B' })
      await repository.softDelete('PPP-AAA-002', { deletedBy: caseOfficer })
    })

    test('findByReference skips deleted registrations by default', async () => {
      expect(await repository.findByReference('PPP-AAA-001')).toMatchObject({
        businessName: 'A'
      })
      expect(await repository.findByReference('PPP-AAA-002')).toBeNull()
    })

    test('findByReference returns a deleted registration with includeDeleted', async () => {
      expect(
        await repository.findByReference('PPP-AAA-002', {
          includeDeleted: true
        })
      ).toMatchObject({ businessName: 'B', isDeleted: true })
    })

    test('findByReference rejects a query operator as the reference', async () => {
      await expect(repository.findByReference({ $ne: null })).rejects.toThrow(
        'reference must be a string'
      )
    })

    test.each(['true', 1, 'false'])(
      'findByReference treats includeDeleted: %s as false',
      async (includeDeleted) => {
        expect(
          await repository.findByReference('PPP-AAA-002', { includeDeleted })
        ).toBeNull()
      }
    )

    test('search skips deleted registrations by default', async () => {
      const found = await repository.search({}, { limit: 10 })

      expect(found.map(({ reference }) => reference)).toEqual(['PPP-AAA-001'])
      expect(found[0]).not.toHaveProperty('_id')
    })

    test('search returns deleted registrations with includeDeleted', async () => {
      const found = await repository.search(
        {},
        { includeDeleted: true, sort: { reference: -1 }, limit: 10 }
      )

      expect(found.map(({ reference }) => reference)).toEqual([
        'PPP-AAA-002',
        'PPP-AAA-001'
      ])
    })

    test('search cannot be told to return deleted registrations through the filter', async () => {
      expect(
        await repository.search({ isDeleted: true }, { limit: 10 })
      ).toEqual([])
    })

    test.each([undefined, 0, -1, 1.5, '10'])(
      'search rejects a limit of %s',
      async (limit) => {
        await expect(repository.search({}, { limit })).rejects.toThrow(
          'limit must be a positive integer'
        )
      }
    )

    test('search applies the filter, skip and limit', async () => {
      await repository.create({ reference: 'PPP-AAA-003', businessName: 'A' })

      const found = await repository.search(
        { businessName: 'A' },
        { sort: { reference: 1 }, skip: 1, limit: 1 }
      )

      expect(found.map(({ reference }) => reference)).toEqual(['PPP-AAA-003'])
    })

    test('treats a registration stored without isDeleted as not deleted', async () => {
      await collection.insertOne({ reference: 'PPP-OLD-001' })

      expect(await repository.findByReference('PPP-OLD-001')).toEqual({
        reference: 'PPP-OLD-001'
      })
    })
  })

  describe('update', () => {
    beforeEach(async () => {
      await repository.create({ reference: 'PPP-AAA-001', businessName: 'Old' })
    })

    test('applies the changes and returns the updated registration', async () => {
      const updated = await repository.update('PPP-AAA-001', {
        businessName: 'New'
      })

      expect(updated).toEqual({
        reference: 'PPP-AAA-001',
        businessName: 'New',
        isDeleted: false
      })
      expect(await stored('PPP-AAA-001')).toEqual(updated)
    })

    test('returns null for an unknown reference', async () => {
      expect(
        await repository.update('PPP-ZZZ-999', { businessName: 'New' })
      ).toBeNull()
    })

    test('does not change a deleted registration', async () => {
      await repository.softDelete('PPP-AAA-001', { deletedBy: caseOfficer })

      expect(
        await repository.update('PPP-AAA-001', { businessName: 'New' })
      ).toBeNull()
      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'Old' })
    })

    test.each([
      '_id',
      'reference',
      'submittedAt',
      'isDeleted',
      'deletedAt',
      'deletedBy.type',
      'deletionReason'
    ])('rejects a change to %s', async (field) => {
      await expect(
        repository.update('PPP-AAA-001', { [field]: 'x' })
      ).rejects.toThrow(`Cannot set protected fields: ${field}`)
    })

    test('rejects a query operator as the reference', async () => {
      await expect(
        repository.update({ $regex: '.' }, { businessName: 'New' })
      ).rejects.toThrow('reference must be a string')
      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'Old' })
    })
  })

  describe('softDelete', () => {
    beforeEach(async () => {
      await repository.create({ reference: 'PPP-AAA-001' })
    })

    test('marks the registration deleted without removing it', async () => {
      const deleted = await repository.softDelete('PPP-AAA-001', {
        deletedBy: caseOfficer,
        reason: 'Duplicate registration'
      })

      expect(deleted).toEqual({
        reference: 'PPP-AAA-001',
        isDeleted: true,
        deletedAt: expect.any(Date),
        deletedBy: caseOfficer,
        deletionReason: 'Duplicate registration'
      })
      expect(await collection.countDocuments()).toBe(1)
      expect(await stored('PPP-AAA-001')).toEqual(deleted)
    })

    test('stores a null reason when none is given', async () => {
      await repository.softDelete('PPP-AAA-001', { deletedBy: caseOfficer })

      expect(await stored('PPP-AAA-001')).toMatchObject({
        isDeleted: true,
        deletionReason: null
      })
    })

    test('returns null when the registration is already deleted', async () => {
      await repository.softDelete('PPP-AAA-001', { deletedBy: caseOfficer })

      expect(
        await repository.softDelete('PPP-AAA-001', { deletedBy: caseOfficer })
      ).toBeNull()
    })

    test('returns null for an unknown reference', async () => {
      expect(
        await repository.softDelete('PPP-ZZZ-999', { deletedBy: caseOfficer })
      ).toBeNull()
    })

    test.each([undefined, null, ''])(
      'requires deletedBy, rejecting %s',
      async (deletedBy) => {
        await expect(
          repository.softDelete('PPP-AAA-001', { deletedBy })
        ).rejects.toThrow('deletedBy is required')
        expect(await stored('PPP-AAA-001')).toMatchObject({ isDeleted: false })
      }
    )

    test('rejects a query operator as the reference', async () => {
      await expect(
        repository.softDelete({ $ne: '' }, { deletedBy: caseOfficer })
      ).rejects.toThrow('reference must be a string')
      expect(await stored('PPP-AAA-001')).toMatchObject({ isDeleted: false })
    })
  })

  describe('withTransaction', () => {
    test('commits every operation when they all succeed', async () => {
      await repository.withTransaction(async (session) => {
        await repository.create({ reference: 'PPP-AAA-001' }, { session })
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { session }
        )
      })

      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'New' })
    })

    test('reads its own writes inside the transaction', async () => {
      const found = await repository.withTransaction(async (session) => {
        await repository.create({ reference: 'PPP-AAA-001' }, { session })
        return repository.findByReference('PPP-AAA-001', { session })
      })

      expect(found).toMatchObject({ reference: 'PPP-AAA-001' })
    })

    test('keeps none of the operations when one fails', async () => {
      await repository.create({ reference: 'PPP-AAA-002' })

      await expect(
        repository.withTransaction(async (session) => {
          await repository.create({ reference: 'PPP-AAA-001' }, { session })
          await repository.create({ reference: 'PPP-AAA-002' }, { session })
        })
      ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

      expect(await stored('PPP-AAA-001')).toBeNull()
    })

    test('rolls back when the work throws', async () => {
      await repository.create({ reference: 'PPP-AAA-001' })

      await expect(
        repository.withTransaction(async (session) => {
          await repository.softDelete('PPP-AAA-001', {
            deletedBy: caseOfficer,
            session
          })
          throw new Error('validation failed')
        })
      ).rejects.toThrow('validation failed')

      expect(await repository.findByReference('PPP-AAA-001')).not.toBeNull()
    })
  })
})
