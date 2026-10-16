import { MongoClient } from 'mongodb'

import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION,
  AUDIT_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  HISTORY_VERSION_INDEX
} from '#/common/constants/history.js'
import { withTransaction } from './mongo-transaction.js'

describe('#withTransaction', () => {
  let client
  let db

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('mongo-transaction-test')
  })

  beforeEach(async () => {
    await db.dropDatabase()
    await Promise.all(
      [
        OCR_REGISTRATION_COLLECTION,
        OCR_REGISTRATION_HISTORY_COLLECTION,
        AUDIT_HISTORY_COLLECTION
      ].map((name) => db.createCollection(name))
    )
    await db
      .collection(OCR_REGISTRATION_HISTORY_COLLECTION)
      .createIndex(HISTORY_VERSION_INDEX.key, HISTORY_VERSION_INDEX.options)
    await db.collection(OCR_REGISTRATION_COLLECTION).insertOne({
      reference: 'PPP-000-001',
      version: FIRST_VERSION,
      businessName: 'Old'
    })
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  const updateWithHistoryAndAudit = (historyVersion) =>
    withTransaction(client, async (txSession) => {
      await db
        .collection(OCR_REGISTRATION_COLLECTION)
        .updateOne(
          { reference: 'PPP-000-001' },
          { $set: { businessName: 'New', version: 2 } },
          { session: txSession }
        )
      await db.collection(OCR_REGISTRATION_HISTORY_COLLECTION).insertOne(
        {
          reference: 'PPP-000-001',
          version: historyVersion,
          operation: HISTORY_OPERATION.UPDATE
        },
        { session: txSession }
      )
      await db
        .collection(AUDIT_HISTORY_COLLECTION)
        .insertOne(
          { reference: 'PPP-000-001', operation: HISTORY_OPERATION.UPDATE },
          { session: txSession }
        )
      return 'done'
    })

  const current = () =>
    db
      .collection(OCR_REGISTRATION_COLLECTION)
      .findOne({ reference: 'PPP-000-001' })

  test('commits every write across the three collections', async () => {
    await expect(updateWithHistoryAndAudit(2)).resolves.toBe('done')

    expect(await current()).toMatchObject({ businessName: 'New', version: 2 })
    expect(
      await db.collection(OCR_REGISTRATION_HISTORY_COLLECTION).countDocuments()
    ).toBe(1)
    expect(await db.collection(AUDIT_HISTORY_COLLECTION).countDocuments()).toBe(
      1
    )
  })

  test('keeps none of the writes when one of them fails', async () => {
    await db.collection(OCR_REGISTRATION_HISTORY_COLLECTION).insertOne({
      reference: 'PPP-000-001',
      version: 2,
      operation: HISTORY_OPERATION.UPDATE
    })

    await expect(updateWithHistoryAndAudit(2)).rejects.toThrow(/duplicate key/)

    expect(await current()).toMatchObject({
      businessName: 'Old',
      version: FIRST_VERSION
    })
    expect(
      await db.collection(OCR_REGISTRATION_HISTORY_COLLECTION).countDocuments()
    ).toBe(1)
    expect(await db.collection(AUDIT_HISTORY_COLLECTION).countDocuments()).toBe(
      0
    )
  })

  test('rolls back when the work itself throws', async () => {
    await expect(
      withTransaction(client, async (session) => {
        await db
          .collection(AUDIT_HISTORY_COLLECTION)
          .insertOne({ reference: 'PPP-000-001' }, { session })
        throw new Error('validation failed')
      })
    ).rejects.toThrow('validation failed')

    expect(await db.collection(AUDIT_HISTORY_COLLECTION).countDocuments()).toBe(
      0
    )
  })
})
