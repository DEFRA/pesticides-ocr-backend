import { MongoClient } from 'mongodb'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  HISTORY_VERSION_INDEX
} from '#/common/constants/history.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { createAuditedRepository } from './audited-repository.js'

const applicant = { type: ACTOR_TYPE.APPLICANT }
const caseOfficer = { type: ACTOR_TYPE.CASE_OFFICER, id: 'officer-1' }

describe('#createAuditedRepository', () => {
  let client
  let db
  let collection
  let historyCollection
  let repository

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('audited-repository-test')
    collection = db.collection(OCR_REGISTRATION_COLLECTION)
    historyCollection = db.collection(OCR_REGISTRATION_HISTORY_COLLECTION)
    repository = createAuditedRepository({ client, db })
  })

  beforeEach(async () => {
    await db.dropDatabase()
    await collection.createIndex({ reference: 1 }, { unique: true })
    await historyCollection.createIndex(
      HISTORY_VERSION_INDEX.key,
      HISTORY_VERSION_INDEX.options
    )
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

      const created = await repository.create(registration, { by: applicant })

      expect(created).toEqual({
        ...registration,
        isDeleted: false,
        version: FIRST_VERSION
      })
      expect(await stored('PPP-AAA-001')).toEqual(created)
      expect(registration).not.toHaveProperty('_id')
    })

    test('stores the submittedAt it is given', async () => {
      const submittedAt = new Date('2026-10-01T09:00:00Z')

      await repository.create(
        { reference: 'PPP-AAA-001', submittedAt },
        { by: applicant }
      )

      expect(await stored('PPP-AAA-001')).toMatchObject({ submittedAt })
    })

    test('rejects lifecycle fields', async () => {
      await expect(
        repository.create(
          { reference: 'PPP-AAA-001', isDeleted: true },
          { by: applicant }
        )
      ).rejects.toThrow('Cannot set protected fields: isDeleted')
    })

    test('rejects a version', async () => {
      await expect(
        repository.create(
          { reference: 'PPP-AAA-001', version: 5 },
          { by: applicant }
        )
      ).rejects.toThrow('Cannot set protected fields: version')
    })

    test('rejects a dotted path into a lifecycle field', async () => {
      await expect(
        repository.create(
          { reference: 'PPP-AAA-001', 'deletedBy.type': 'x' },
          { by: applicant }
        )
      ).rejects.toThrow('Cannot set protected fields: deletedBy.type')
    })

    test.each([undefined, '', { $gt: '' }])(
      'rejects a reference of %s',
      async (reference) => {
        await expect(
          repository.create({ reference }, { by: applicant })
        ).rejects.toThrow('reference must be a non-empty string')
      }
    )

    test.each([
      ['no registration', undefined],
      ['null', null],
      ['a list', []]
    ])('rejects %s', async (_label, value) => {
      await expect(repository.create(value)).rejects.toThrow(
        'registration must be an object'
      )
      expect(await collection.countDocuments()).toBe(0)
    })

    test('rethrows a duplicate reference error', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      await expect(
        repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
      ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })
    })
  })

  describe('reads', () => {
    beforeEach(async () => {
      await repository.create(
        { reference: 'PPP-AAA-001', businessName: 'A' },
        { by: applicant }
      )
      await repository.create(
        { reference: 'PPP-AAA-002', businessName: 'B' },
        { by: applicant }
      )
      await repository.softDelete('PPP-AAA-002', { by: caseOfficer })
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
        'reference must be a non-empty string'
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
      await repository.create(
        { reference: 'PPP-AAA-003', businessName: 'A' },
        { by: applicant }
      )

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
      await repository.create(
        { reference: 'PPP-AAA-001', businessName: 'Old' },
        { by: applicant }
      )
    })

    test('applies the changes and returns the updated registration', async () => {
      const updated = await repository.update(
        'PPP-AAA-001',
        {
          businessName: 'New'
        },
        { by: caseOfficer }
      )

      expect(updated).toEqual({
        reference: 'PPP-AAA-001',
        businessName: 'New',
        isDeleted: false,
        version: 2
      })
      expect(await stored('PPP-AAA-001')).toEqual(updated)
    })

    test('returns null for an unknown reference', async () => {
      expect(
        await repository.update(
          'PPP-ZZZ-999',
          { businessName: 'New' },
          { by: caseOfficer }
        )
      ).toBeNull()
    })

    test('does not change a deleted registration', async () => {
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })

      expect(
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { by: caseOfficer }
        )
      ).toBeNull()
      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'Old' })
    })

    test.each([
      '_id',
      'reference',
      'submittedAt',
      'version',
      'isDeleted',
      'deletedAt',
      'deletedBy.type',
      'deletionReason'
    ])('rejects a change to %s', async (field) => {
      await expect(
        repository.update('PPP-AAA-001', { [field]: 'x' }, { by: caseOfficer })
      ).rejects.toThrow(`Cannot set protected fields: ${field}`)
    })

    test.each([
      ['no changes', undefined],
      ['null', null],
      ['a list', []]
    ])('rejects %s as the changes', async (_label, value) => {
      await expect(repository.update('PPP-AAA-001', value)).rejects.toThrow(
        'changes must be an object'
      )
      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'Old' })
    })

    test('rejects a query operator as the reference', async () => {
      await expect(
        repository.update(
          { $regex: '.' },
          { businessName: 'New' },
          { by: caseOfficer }
        )
      ).rejects.toThrow('reference must be a non-empty string')
      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'Old' })
    })
  })

  describe('softDelete', () => {
    beforeEach(async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
    })

    test('marks the registration deleted without removing it', async () => {
      const deleted = await repository.softDelete('PPP-AAA-001', {
        by: caseOfficer,
        reason: 'Duplicate registration'
      })

      expect(deleted).toEqual({
        reference: 'PPP-AAA-001',
        isDeleted: true,
        version: 2,
        deletedAt: expect.any(Date),
        deletedBy: caseOfficer,
        deletionReason: 'Duplicate registration'
      })
      expect(await collection.countDocuments()).toBe(1)
      expect(await stored('PPP-AAA-001')).toEqual(deleted)
    })

    test('stores a null reason when none is given', async () => {
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })

      expect(await stored('PPP-AAA-001')).toMatchObject({
        isDeleted: true,
        deletionReason: null
      })
    })

    test('returns null when the registration is already deleted', async () => {
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })

      expect(
        await repository.softDelete('PPP-AAA-001', { by: caseOfficer })
      ).toBeNull()
    })

    test('returns null for an unknown reference', async () => {
      expect(
        await repository.softDelete('PPP-ZZZ-999', { by: caseOfficer })
      ).toBeNull()
    })

    test('rejects a query operator as the reference', async () => {
      await expect(
        repository.softDelete({ $ne: '' }, { by: caseOfficer })
      ).rejects.toThrow('reference must be a non-empty string')
      expect(await stored('PPP-AAA-001')).toMatchObject({ isDeleted: false })
    })
  })

  describe('withTransaction', () => {
    test('commits every operation when they all succeed', async () => {
      await repository.withTransaction(async (session) => {
        await repository.create(
          { reference: 'PPP-AAA-001' },
          { by: applicant, session }
        )
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { by: caseOfficer, session }
        )
      })

      expect(await stored('PPP-AAA-001')).toMatchObject({ businessName: 'New' })
    })

    test('reads its own writes inside the transaction', async () => {
      const found = await repository.withTransaction(async (session) => {
        await repository.create(
          { reference: 'PPP-AAA-001' },
          { by: applicant, session }
        )
        return repository.findByReference('PPP-AAA-001', { session })
      })

      expect(found).toMatchObject({ reference: 'PPP-AAA-001' })
    })

    test('keeps none of the operations when one fails', async () => {
      await repository.create({ reference: 'PPP-AAA-002' }, { by: applicant })

      await expect(
        repository.withTransaction(async (session) => {
          await repository.create(
            { reference: 'PPP-AAA-001' },
            { by: applicant, session }
          )
          await repository.create(
            { reference: 'PPP-AAA-002' },
            { by: applicant, session }
          )
        })
      ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

      expect(await stored('PPP-AAA-001')).toBeNull()
    })

    test('rolls back when the work throws', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      await expect(
        repository.withTransaction(async (session) => {
          await repository.softDelete('PPP-AAA-001', {
            by: caseOfficer,
            session
          })
          throw new Error('validation failed')
        })
      ).rejects.toThrow('validation failed')

      expect(await repository.findByReference('PPP-AAA-001')).not.toBeNull()
    })
  })

  describe('history', () => {
    const historyOf = (reference) =>
      historyCollection
        .find({ reference }, { projection: { _id: 0 } })
        .sort({ version: 1 })
        .toArray()

    test('create writes version 1 with the full registration', async () => {
      const created = await repository.create(
        { reference: 'PPP-AAA-001', businessName: 'Acme' },
        { by: applicant }
      )

      expect(await historyOf('PPP-AAA-001')).toEqual([
        {
          reference: 'PPP-AAA-001',
          version: FIRST_VERSION,
          operation: HISTORY_OPERATION.CREATE,
          at: expect.any(Date),
          by: applicant,
          snapshot: created
        }
      ])
    })

    test('update records the case officer, reason and request ID', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      const updated = await repository.update(
        'PPP-AAA-001',
        { businessName: 'New' },
        { by: caseOfficer, reason: 'Corrected the name', requestId: 'req-1' }
      )

      const [, entry] = await historyOf('PPP-AAA-001')
      expect(entry).toEqual({
        reference: 'PPP-AAA-001',
        version: 2,
        operation: HISTORY_OPERATION.UPDATE,
        at: expect.any(Date),
        by: caseOfficer,
        reason: 'Corrected the name',
        requestId: 'req-1',
        snapshot: updated
      })
    })

    test('softDelete records a delete version at the time of deletion', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      const deleted = await repository.softDelete('PPP-AAA-001', {
        by: caseOfficer,
        reason: 'Duplicate registration'
      })

      const [, entry] = await historyOf('PPP-AAA-001')
      expect(entry).toMatchObject({
        version: 2,
        operation: HISTORY_OPERATION.DELETE,
        at: deleted.deletedAt,
        reason: 'Duplicate registration',
        snapshot: deleted
      })
    })

    test('each change adds the next version', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
      await repository.update(
        'PPP-AAA-001',
        { businessName: 'A' },
        { by: caseOfficer }
      )
      await repository.update(
        'PPP-AAA-001',
        { businessName: 'B' },
        { by: caseOfficer }
      )
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })

      const entries = await historyOf('PPP-AAA-001')
      expect(
        entries.map(({ version, operation }) => [version, operation])
      ).toEqual([
        [1, HISTORY_OPERATION.CREATE],
        [2, HISTORY_OPERATION.UPDATE],
        [3, HISTORY_OPERATION.UPDATE],
        [4, HISTORY_OPERATION.DELETE]
      ])
      expect(
        await repository.findByReference('PPP-AAA-001', {
          includeDeleted: true
        })
      ).toMatchObject({ version: 4 })
    })

    test('writes no history when there is nothing to change', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })

      await repository.update(
        'PPP-AAA-001',
        { businessName: 'New' },
        { by: caseOfficer }
      )
      await repository.softDelete('PPP-AAA-001', { by: caseOfficer })
      await repository.update(
        'PPP-ZZZ-999',
        { businessName: 'New' },
        { by: caseOfficer }
      )

      expect(await historyCollection.countDocuments()).toBe(2)
    })

    test.each([
      ['an unknown actor type', { type: 'case-officer' }],
      [
        'an email address',
        { type: ACTOR_TYPE.CASE_OFFICER, id: 'officer-1', email: 'a@b.c' }
      ],
      ['a case officer with no id', { type: ACTOR_TYPE.CASE_OFFICER }],
      [
        'an email address as a case officer id',
        { type: ACTOR_TYPE.CASE_OFFICER, id: 'jane@example.com' }
      ],
      [
        'an email address as an applicant id',
        { type: ACTOR_TYPE.APPLICANT, id: 'joe@example.com' }
      ]
    ])('rejects %s in by, storing nothing', async (_label, by) => {
      await expect(
        repository.create({ reference: 'PPP-AAA-001' }, { by })
      ).rejects.toThrow('Invalid audit details')

      expect(await stored('PPP-AAA-001')).toBeNull()
      expect(await historyCollection.countDocuments()).toBe(0)
    })

    describe('who made the change', () => {
      beforeEach(async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
      })

      const writes = [
        [
          'create',
          (by) => repository.create({ reference: 'PPP-AAA-002' }, { by })
        ],
        [
          'update',
          (by) =>
            repository.update('PPP-AAA-001', { businessName: 'New' }, { by })
        ],
        ['softDelete', (by) => repository.softDelete('PPP-AAA-001', { by })]
      ]
      const badActors = [undefined, null, '', [], 'applicant']

      test.each(
        writes.flatMap(([method, write]) =>
          badActors.map((by) => [
            method,
            JSON.stringify(by) ?? 'undefined',
            write,
            by
          ])
        )
      )(
        '%s rejects by %s, changing nothing',
        async (_method, _label, write, by) => {
          await expect(write(by)).rejects.toThrow('Invalid audit details')

          expect(await stored('PPP-AAA-001')).toEqual({
            reference: 'PPP-AAA-001',
            isDeleted: false,
            version: FIRST_VERSION
          })
          expect(await stored('PPP-AAA-002')).toBeNull()
          expect(await historyCollection.countDocuments()).toBe(1)
        }
      )

      test('treats a null requestId as no requestId', async () => {
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { by: caseOfficer, requestId: null }
        )

        const [, updated] = await historyOf('PPP-AAA-001')
        expect(updated).not.toHaveProperty('requestId')
      })

      test('treats an empty reason and request ID as none', async () => {
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { by: caseOfficer, reason: '', requestId: '' }
        )

        const [, updated] = await historyOf('PPP-AAA-001')
        expect(updated).not.toHaveProperty('reason')
        expect(updated).not.toHaveProperty('requestId')
      })

      test('treats a null reason as no reason', async () => {
        await repository.update(
          'PPP-AAA-001',
          { businessName: 'New' },
          { by: caseOfficer, reason: null }
        )
        await repository.softDelete('PPP-AAA-001', {
          by: caseOfficer,
          reason: null
        })

        const [, updated, deleted] = await historyOf('PPP-AAA-001')
        expect(updated).not.toHaveProperty('reason')
        expect(deleted).not.toHaveProperty('reason')
        expect(await stored('PPP-AAA-001')).toMatchObject({
          deletionReason: null
        })
      })
    })

    test.each([
      [
        'create',
        (session) =>
          repository.create(
            { reference: 'PPP-AAA-002' },
            { by: applicant, session }
          )
      ],
      [
        'update',
        (session) =>
          repository.update(
            'PPP-AAA-001',
            { businessName: 'New' },
            { by: caseOfficer, session }
          )
      ],
      [
        'softDelete',
        (session) =>
          repository.softDelete('PPP-AAA-001', { by: caseOfficer, session })
      ]
    ])(
      '%s rejects a session that did not come from withTransaction',
      async (_method, write) => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        const session = client.startSession()
        try {
          await expect(write(session)).rejects.toThrow(
            'session must come from withTransaction'
          )
          session.startTransaction()
          await expect(write(session)).rejects.toThrow(
            'session must come from withTransaction'
          )
          await session.abortTransaction()
        } finally {
          await session.endSession()
        }

        expect(await stored('PPP-AAA-001')).toEqual({
          reference: 'PPP-AAA-001',
          isDeleted: false,
          version: FIRST_VERSION
        })
        expect(await stored('PPP-AAA-002')).toBeNull()
        expect(await historyCollection.countDocuments()).toBe(1)
      }
    )

    test.each([
      ['create', () => repository.create({ reference: 'PPP-AAA-002' }, null)],
      [
        'update',
        () => repository.update('PPP-AAA-001', { businessName: 'New' }, null)
      ],
      ['softDelete', () => repository.softDelete('PPP-AAA-001', null)]
    ])('%s rejects null options with a clear error', async (_method, write) => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      await expect(write()).rejects.toThrow('Invalid audit details')
      expect(await historyCollection.countDocuments()).toBe(1)
    })

    test('reads accept null options', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      expect(
        await repository.findByReference('PPP-AAA-001', null)
      ).toMatchObject({
        reference: 'PPP-AAA-001'
      })
      await expect(repository.search({}, null)).rejects.toThrow(
        'limit must be a positive integer'
      )
    })

    test.each([null, [], 'filter'])(
      'search rejects %s as the filter',
      async (filter) => {
        await expect(repository.search(filter, { limit: 10 })).rejects.toThrow(
          'filter must be an object'
        )
      }
    )

    test('rejects an update with no changes', async () => {
      await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

      await expect(
        repository.update('PPP-AAA-001', {}, { by: caseOfficer })
      ).rejects.toThrow('changes must not be empty')
      expect(await historyCollection.countDocuments()).toBe(1)
    })

    test('a registration stored with no version gets version 1 on its first change', async () => {
      await collection.insertOne({ reference: 'PPP-OLD-001' })

      await repository.update(
        'PPP-OLD-001',
        { businessName: 'New' },
        { by: caseOfficer }
      )

      expect(await stored('PPP-OLD-001')).toMatchObject({ version: 1 })
      expect(
        (await historyOf('PPP-OLD-001')).map(({ version, operation }) => [
          version,
          operation
        ])
      ).toEqual([[1, HISTORY_OPERATION.UPDATE]])
    })

    describe('rollback', () => {
      const takeVersion = (version) =>
        historyCollection.insertOne({ reference: 'PPP-AAA-001', version })

      test('create keeps no registration when its history entry fails', async () => {
        await takeVersion(FIRST_VERSION)

        await expect(
          repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

        expect(await stored('PPP-AAA-001')).toBeNull()
      })

      test('update keeps the registration unchanged when its history entry fails', async () => {
        await repository.create(
          { reference: 'PPP-AAA-001', businessName: 'Old' },
          { by: applicant }
        )
        await takeVersion(2)

        await expect(
          repository.update(
            'PPP-AAA-001',
            { businessName: 'New' },
            { by: caseOfficer }
          )
        ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

        expect(await stored('PPP-AAA-001')).toMatchObject({
          businessName: 'Old',
          version: FIRST_VERSION
        })
      })

      test('softDelete keeps the registration when its history entry fails', async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        await takeVersion(2)

        await expect(
          repository.softDelete('PPP-AAA-001', { by: caseOfficer })
        ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

        expect(await stored('PPP-AAA-001')).toMatchObject({
          isDeleted: false,
          version: FIRST_VERSION
        })
      })

      test('a failed registration update writes no history', async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

        await expect(
          repository.update(
            'PPP-AAA-001',
            { details: 'x', 'details.name': 'y' },
            { by: caseOfficer }
          )
        ).rejects.toThrow(/would create a conflict/)

        expect(await historyCollection.countDocuments()).toBe(1)
        expect(await stored('PPP-AAA-001')).toMatchObject({
          version: FIRST_VERSION
        })
      })

      test('a failed registration change writes no history', async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })

        await expect(
          repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

        expect(await historyCollection.countDocuments()).toBe(1)
      })

      test('a caller that catches a failed change still commits nothing', async () => {
        await repository.create(
          { reference: 'PPP-AAA-001', businessName: 'Old' },
          { by: applicant }
        )
        await takeVersion(2)

        await expect(
          repository.withTransaction(async (session) => {
            await repository.create(
              { reference: 'PPP-AAA-002' },
              { by: applicant, session }
            )
            await repository
              .update(
                'PPP-AAA-001',
                { businessName: 'New' },
                { by: caseOfficer, session }
              )
              .catch(() => {})
            await repository.create(
              { reference: 'PPP-AAA-003' },
              { by: applicant, session }
            )
            return 'ok'
          })
        ).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR })

        expect(await stored('PPP-AAA-001')).toMatchObject({
          businessName: 'Old',
          version: FIRST_VERSION
        })
        expect(await stored('PPP-AAA-002')).toBeNull()
        expect(await stored('PPP-AAA-003')).toBeNull()
      })

      test.each([
        [
          'a failed write',
          (session) => {
            const looped = { reference: 'PPP-AAA-009' }
            looped.self = looped
            return repository.create(looped, { by: applicant, session })
          }
        ],
        [
          'a failed check',
          (session) =>
            repository.update(
              'PPP-AAA-001',
              { businessName: 'New' },
              { by: { type: 'case-officer' }, session }
            )
        ]
      ])(
        'a caller that catches %s and returns normally still commits nothing',
        async (_label, failing) => {
          await repository.create(
            { reference: 'PPP-AAA-001', businessName: 'Old' },
            { by: applicant }
          )

          await expect(
            repository.withTransaction(async (session) => {
              await repository.create(
                { reference: 'PPP-AAA-002' },
                { by: applicant, session }
              )
              await failing(session).catch(() => {})
              return 'ok'
            })
          ).rejects.toThrow()

          expect(await stored('PPP-AAA-002')).toBeNull()
          expect(await stored('PPP-AAA-001')).toMatchObject({
            businessName: 'Old',
            version: FIRST_VERSION
          })
          expect(await historyCollection.countDocuments()).toBe(1)
        }
      )

      test('concurrent callers that wrap a write conflict in their own error are still retried', async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        const callers = 5

        await Promise.all(
          Array.from({ length: callers }, (_, i) =>
            repository.withTransaction((session) =>
              repository
                .update(
                  'PPP-AAA-001',
                  { [`field${i}`]: i },
                  { by: caseOfficer, session }
                )
                .catch((error) => {
                  throw new Error(`could not save: ${error.message}`)
                })
            )
          )
        )

        expect(await stored('PPP-AAA-001')).toMatchObject({
          version: FIRST_VERSION + callers
        })
      })

      test('concurrent callers that catch a write conflict are retried until every change lands', async () => {
        await repository.create({ reference: 'PPP-AAA-001' }, { by: applicant })
        const callers = 10

        await Promise.all(
          Array.from({ length: callers }, (_, i) =>
            repository.withTransaction((session) =>
              repository
                .update(
                  'PPP-AAA-001',
                  { [`field${i}`]: i },
                  { by: caseOfficer, session }
                )
                .catch(() => {})
            )
          )
        )

        expect(await stored('PPP-AAA-001')).toMatchObject({
          version: FIRST_VERSION + callers
        })
        expect(await historyCollection.countDocuments()).toBe(callers + 1)
      })

      test('a caller transaction that fails keeps no registration or history', async () => {
        await expect(
          repository.withTransaction(async (session) => {
            await repository.create(
              { reference: 'PPP-AAA-001' },
              { by: applicant, session }
            )
            await repository.update(
              'PPP-AAA-001',
              { businessName: 'New' },
              { by: caseOfficer, session }
            )
            throw new Error('validation failed')
          })
        ).rejects.toThrow('validation failed')

        expect(await stored('PPP-AAA-001')).toBeNull()
        expect(await historyCollection.countDocuments()).toBe(0)
      })
    })
  })
})
