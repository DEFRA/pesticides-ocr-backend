import { MongoClient } from 'mongodb'

import { withTransaction } from './mongo-transaction.js'

const REGISTRATIONS = 'ocr-registration'
const HISTORY = 'ocr-registration_history'
const AUDIT = 'audit_history'

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
      [REGISTRATIONS, HISTORY, AUDIT].map((name) => db.createCollection(name))
    )
    await db
      .collection(HISTORY)
      .createIndex({ reference: 1, version: 1 }, { unique: true })
    await db
      .collection(REGISTRATIONS)
      .insertOne({ reference: 'PPP-000-001', version: 1, businessName: 'Old' })
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  const updateWithHistoryAndAudit = (historyVersion) =>
    withTransaction(client, async (txSession) => {
      await db
        .collection(REGISTRATIONS)
        .updateOne(
          { reference: 'PPP-000-001' },
          { $set: { businessName: 'New', version: 2 } },
          { session: txSession }
        )
      await db.collection(HISTORY).insertOne(
        {
          reference: 'PPP-000-001',
          version: historyVersion,
          operation: 'update'
        },
        { session: txSession }
      )
      await db
        .collection(AUDIT)
        .insertOne(
          { reference: 'PPP-000-001', operation: 'update' },
          { session: txSession }
        )
      return 'done'
    })

  const current = () =>
    db.collection(REGISTRATIONS).findOne({ reference: 'PPP-000-001' })

  test('commits every write across the three collections', async () => {
    await expect(updateWithHistoryAndAudit(2)).resolves.toBe('done')

    expect(await current()).toMatchObject({ businessName: 'New', version: 2 })
    expect(await db.collection(HISTORY).countDocuments()).toBe(1)
    expect(await db.collection(AUDIT).countDocuments()).toBe(1)
  })

  test('keeps none of the writes when one of them fails', async () => {
    await db
      .collection(HISTORY)
      .insertOne({ reference: 'PPP-000-001', version: 2, operation: 'update' })

    await expect(updateWithHistoryAndAudit(2)).rejects.toThrow(/duplicate key/)

    expect(await current()).toMatchObject({ businessName: 'Old', version: 1 })
    expect(await db.collection(HISTORY).countDocuments()).toBe(1)
    expect(await db.collection(AUDIT).countDocuments()).toBe(0)
  })

  test('rolls back when the work itself throws', async () => {
    await expect(
      withTransaction(client, async (session) => {
        await db
          .collection(AUDIT)
          .insertOne({ reference: 'PPP-000-001' }, { session })
        throw new Error('validation failed')
      })
    ).rejects.toThrow('validation failed')

    expect(await db.collection(AUDIT).countDocuments()).toBe(0)
  })
})
