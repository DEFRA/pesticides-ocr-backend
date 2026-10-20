import { MongoClient } from 'mongodb'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { OCR_REGISTRATION_HISTORY_COLLECTION } from '#/common/constants/collections.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  HISTORY_VERSION_INDEX,
  MAX_BY_ID_LENGTH,
  MAX_REASON_LENGTH,
  MAX_REQUEST_ID_LENGTH
} from '#/common/constants/history.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { withTransaction } from '#/repositories/mongo-transaction.js'
import {
  assertAudit,
  createRegistrationHistory
} from './registration-history.js'

const entry = (overrides = {}) => ({
  reference: 'PPP-AAA-001',
  version: FIRST_VERSION,
  operation: HISTORY_OPERATION.CREATE,
  at: new Date('2026-10-09T10:30:00Z'),
  by: { type: ACTOR_TYPE.APPLICANT },
  snapshot: { reference: 'PPP-AAA-001', businessName: 'Acme' },
  ...overrides
})

describe('#createRegistrationHistory', () => {
  let client
  let db
  let collection
  let history

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('registration-history-test')
    collection = db.collection(OCR_REGISTRATION_HISTORY_COLLECTION)
    history = createRegistrationHistory({ db })
  })

  beforeEach(async () => {
    await db.dropDatabase()
    await collection.createIndex(
      HISTORY_VERSION_INDEX.key,
      HISTORY_VERSION_INDEX.options
    )
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  test('offers no way to change or remove an entry', () => {
    expect(Object.keys(history).sort()).toEqual([
      'append',
      'findVersion',
      'list'
    ])
  })

  describe('append', () => {
    test('stores the full entry, including the snapshot', async () => {
      const full = entry({
        by: { type: ACTOR_TYPE.CASE_OFFICER, id: 'entra-subject-id' },
        reason: 'Registration details updated',
        requestId: 'request-id'
      })

      expect(await history.append(full)).toEqual(full)
      expect(await history.findVersion('PPP-AAA-001', FIRST_VERSION)).toEqual(
        full
      )
      expect(full).not.toHaveProperty('_id')
    })

    test('stores an entry without the optional reason and requestId', async () => {
      await history.append(entry())

      expect(
        await history.findVersion('PPP-AAA-001', FIRST_VERSION)
      ).not.toHaveProperty('reason')
    })

    test('rejects a second entry for the same version', async () => {
      await history.append(entry())

      await expect(history.append(entry())).rejects.toMatchObject({
        code: MONGO_DUPLICATE_KEY_ERROR
      })
      expect(await collection.countDocuments()).toBe(1)
    })

    test('stores the same version for different registrations', async () => {
      await history.append(entry())
      await history.append(
        entry({
          reference: 'PPP-AAA-002',
          snapshot: { reference: 'PPP-AAA-002' }
        })
      )

      expect(await collection.countDocuments()).toBe(2)
    })

    test.each([
      ['a missing reference', { reference: undefined }],
      ['a missing version', { version: undefined }],
      ['a missing operation', { operation: undefined }],
      ['a missing date', { at: undefined }],
      ['an invalid date', { at: new Date('not a date') }],
      [
        'an unknown field in by',
        { by: { type: ACTOR_TYPE.APPLICANT, email: 'a@b.c' } }
      ],
      ['a reason that is not text', { reason: 42 }],
      [
        'a reason that is too long',
        { reason: 'x'.repeat(MAX_REASON_LENGTH + 1) }
      ],
      [
        'a requestId that is too long',
        { requestId: 'x'.repeat(MAX_REQUEST_ID_LENGTH + 1) }
      ],
      [
        'a by.id that is too long',
        {
          by: {
            type: ACTOR_TYPE.CASE_OFFICER,
            id: 'x'.repeat(MAX_BY_ID_LENGTH + 1)
          }
        }
      ],
      ['a snapshot that is a list', { snapshot: [] }],
      [
        'a snapshot of another registration',
        { snapshot: { reference: 'PPP-BBB-002' } }
      ],
      ['a snapshot with no reference', { snapshot: { businessName: 'Acme' } }],
      ['version 0', { version: 0 }],
      ['a fractional version', { version: 1.5 }],
      ['a version given as text', { version: '1' }],
      ['an unknown operation', { operation: 'status-changed' }],
      ['a date given as text', { at: '2026-10-09T10:30:00Z' }],
      ['an unknown actor type', { by: { type: 'case-officer' } }],
      ['a case officer with no id', { by: { type: ACTOR_TYPE.CASE_OFFICER } }],
      [
        'an email address as the id',
        { by: { type: ACTOR_TYPE.CASE_OFFICER, id: 'jane@example.com' } }
      ],
      ['a missing actor', { by: undefined }],
      ['a missing snapshot', { snapshot: undefined }],
      ['an unknown field', { status: 'accepted' }]
    ])('rejects an entry with %s', async (_label, overrides) => {
      await expect(history.append(entry(overrides))).rejects.toThrow(
        'Invalid history entry'
      )
      expect(await collection.countDocuments()).toBe(0)
    })

    test.each([
      ['no entry', undefined],
      ['null', null],
      ['a list', []],
      ['text', 'entry']
    ])('rejects %s as the entry', async (_label, value) => {
      await expect(history.append(value)).rejects.toThrow(
        'Invalid history entry'
      )
      expect(await collection.countDocuments()).toBe(0)
    })

    test('joins a transaction through the session', async () => {
      await expect(
        withTransaction(client, async (session) => {
          await history.append(entry(), { session })
          throw new Error('rolled back')
        })
      ).rejects.toThrow('rolled back')

      expect(await collection.countDocuments()).toBe(0)
    })
  })

  describe('findVersion', () => {
    test('returns null for a version that does not exist', async () => {
      expect(await history.findVersion('PPP-AAA-001', 2)).toBeNull()
    })

    test.each([
      [
        'reference',
        { $ne: '' },
        FIRST_VERSION,
        'reference must be a non-empty string'
      ],
      ['version', 'PPP-AAA-001', { $gt: 0 }, 'version must be an integer']
    ])(
      'rejects a query operator as the %s',
      async (_l, reference, version, message) => {
        await expect(history.findVersion(reference, version)).rejects.toThrow(
          message
        )
      }
    )
  })

  describe('list', () => {
    beforeEach(async () => {
      await history.append(
        entry({ version: 2, operation: HISTORY_OPERATION.UPDATE })
      )
      await history.append(entry())
      await history.append(
        entry({ version: 3, operation: HISTORY_OPERATION.DELETE })
      )
      await history.append(
        entry({
          reference: 'PPP-AAA-002',
          snapshot: { reference: 'PPP-AAA-002' }
        })
      )
    })

    test("returns one registration's versions newest first", async () => {
      const versions = await history.list('PPP-AAA-001', { limit: 10 })

      expect(versions.map(({ version }) => version)).toEqual([3, 2, 1])
      expect(versions[0]).not.toHaveProperty('_id')
    })

    test('keeps the newest versions when there are more than the limit', async () => {
      const versions = await history.list('PPP-AAA-001', { limit: 2 })

      expect(versions.map(({ version }) => version)).toEqual([3, 2])
    })

    test('gives the latest version with a limit of 1', async () => {
      const [latest] = await history.list('PPP-AAA-001', { limit: 1 })

      expect(latest).toMatchObject({
        version: 3,
        operation: HISTORY_OPERATION.DELETE
      })
    })

    test.each([undefined, 0, -1, 1.5])(
      'rejects a limit of %s',
      async (limit) => {
        await expect(history.list('PPP-AAA-001', { limit })).rejects.toThrow(
          'limit must be a positive integer'
        )
      }
    )

    test('rejects a query operator as the reference', async () => {
      await expect(history.list({ $ne: '' }, { limit: 10 })).rejects.toThrow(
        'reference must be a non-empty string'
      )
    })
  })
})

describe('#assertAudit', () => {
  test.each([
    ['an Entra subject ID', 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ'],
    ['an Entra object ID', '00000000-0000-0000-0000-000000000000'],
    ['an opaque ID that contains @', 'a@b']
  ])('accepts %s as a case officer id', (_label, id) => {
    expect(() =>
      assertAudit({ by: { type: ACTOR_TYPE.CASE_OFFICER, id } })
    ).not.toThrow()
  })

  test.each(['jane@example.com', 'x@example.co.uk'])(
    'rejects the email address %s as an id',
    (id) => {
      expect(() =>
        assertAudit({ by: { type: ACTOR_TYPE.CASE_OFFICER, id } })
      ).toThrow('must not be an email address')
    }
  )

  test.each([
    ['an applicant', { by: { type: ACTOR_TYPE.APPLICANT } }],
    [
      'a case officer with a reason and request ID',
      {
        by: { type: ACTOR_TYPE.CASE_OFFICER, id: 'entra-subject-id' },
        reason: 'Corrected the name',
        requestId: 'request-id'
      }
    ]
  ])('accepts %s', (_label, audit) => {
    expect(() => assertAudit(audit)).not.toThrow()
  })

  test.each([
    ['no audit details', undefined],
    ['null', null],
    ['a list', []],
    ['text', 'applicant'],
    ['no actor', {}],
    ['a case officer with no id', { by: { type: ACTOR_TYPE.CASE_OFFICER } }],
    [
      'a reason that is too long',
      {
        by: { type: ACTOR_TYPE.APPLICANT },
        reason: 'x'.repeat(MAX_REASON_LENGTH + 1)
      }
    ]
  ])('rejects %s', (_label, audit) => {
    expect(() => assertAudit(audit)).toThrow('Invalid audit details')
  })
})
