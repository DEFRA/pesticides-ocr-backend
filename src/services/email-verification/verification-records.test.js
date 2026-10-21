import { MongoClient } from 'mongodb'
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'

import {
  EMAIL_VERIFICATIONS_COLLECTION,
  EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
} from '#/common/constants/collections.js'
import { transactionOptions } from '#/repositories/mongo-transaction.js'
import { generateLinkToken } from '#/services/email-verification/link-token.js'
import {
  STATUS,
  activateRecord,
  deleteSendingRecord,
  findByTokenHash,
  findLatestRecord,
  findRecentVerification,
  insertSendingRecord,
  markVerified
} from '#/services/email-verification/verification-records.js'

const settings = { linkTtlSeconds: 900, recordRetentionSeconds: 86400 }
const NOW = new Date('2026-10-15T10:00:00.000Z')
const LATER = new Date('2026-10-15T10:02:00.000Z')

let client
let db
let records

beforeAll(async () => {
  client = await MongoClient.connect(process.env.MONGO_URI)
  db = client.db('email-verification-records-test')
  records = db.collection(EMAIL_VERIFICATIONS_COLLECTION)
})

// The server creates both collections at start-up (with their indexes), so a
// transaction never has to.
beforeEach(async () => {
  await db.dropDatabase()
  await db.createCollection(EMAIL_VERIFICATIONS_COLLECTION)
  await db.createCollection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)
})

afterAll(async () => {
  await db.dropDatabase()
  await client.close()
})

const insert = (journeyId = 'journey-1') =>
  insertSendingRecord(db, {
    journeyId,
    email: 'jane@example.com',
    tokenHash: generateLinkToken().tokenHash,
    now: NOW,
    settings
  })

const statusOf = async (_id) => (await records.findOne({ _id })).status

describe('#insertSendingRecord', () => {
  test('stores a sending record that expires after the link TTL', async () => {
    const tokenHash = generateLinkToken().tokenHash

    const { _id, expiresAt } = await insertSendingRecord(db, {
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash,
      now: NOW,
      settings
    })

    expect(expiresAt).toEqual(new Date('2026-10-15T10:15:00.000Z'))
    expect(await records.findOne({ _id })).toEqual({
      _id,
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash,
      status: STATUS.SENDING,
      createdAt: NOW,
      expiresAt,
      verifiedAt: null,
      supersededAt: null,
      purgeAt: new Date('2026-10-16T10:00:00.000Z')
    })
  })
})

describe('#deleteSendingRecord', () => {
  test('deletes a record that is still sending', async () => {
    const { _id } = await insert()

    await deleteSendingRecord(db, _id)

    expect(await records.countDocuments()).toBe(0)
  })

  test('leaves a record that has been activated', async () => {
    const { _id } = await insert()
    await activateRecord(
      { client, db },
      { _id, journeyId: 'journey-1', now: NOW }
    )

    await deleteSendingRecord(db, _id)

    expect(await statusOf(_id)).toBe(STATUS.PENDING)
  })
})

describe('#activateRecord', () => {
  test('makes the record pending', async () => {
    const { _id } = await insert()

    await activateRecord(
      { client, db },
      { _id, journeyId: 'journey-1', now: NOW }
    )

    expect(await statusOf(_id)).toBe(STATUS.PENDING)
  })

  test('supersedes the journey’s earlier pending links', async () => {
    const first = await insert()
    await activateRecord(
      { client, db },
      { _id: first._id, journeyId: 'journey-1', now: NOW }
    )
    const second = await insert()

    await activateRecord(
      { client, db },
      { _id: second._id, journeyId: 'journey-1', now: LATER }
    )

    expect(await records.findOne({ _id: first._id })).toMatchObject({
      status: STATUS.SUPERSEDED,
      supersededAt: LATER
    })
    expect(await statusOf(second._id)).toBe(STATUS.PENDING)
  })

  test('leaves verified links and other journeys alone', async () => {
    const verified = await insert()
    await records.updateOne(
      { _id: verified._id },
      { $set: { status: STATUS.VERIFIED } }
    )
    const otherJourney = await insert('journey-2')
    await activateRecord(
      { client, db },
      { _id: otherJourney._id, journeyId: 'journey-2', now: NOW }
    )
    const latest = await insert()

    await activateRecord(
      { client, db },
      { _id: latest._id, journeyId: 'journey-1', now: LATER }
    )

    expect(await statusOf(verified._id)).toBe(STATUS.VERIFIED)
    expect(await statusOf(otherJourney._id)).toBe(STATUS.PENDING)
  })

  test('rejects, changing nothing, when the record is no longer sending', async () => {
    const earlier = await insert()
    await activateRecord(
      { client, db },
      { _id: earlier._id, journeyId: 'journey-1', now: NOW }
    )
    const { _id } = await insert()
    await deleteSendingRecord(db, _id)

    await expect(
      activateRecord(
        { client, db },
        { _id, journeyId: 'journey-1', now: LATER }
      )
    ).rejects.toThrow('no longer sending')

    expect(await statusOf(earlier._id)).toBe(STATUS.PENDING)
  })

  // Holds a first activation's transaction open while a second runs. Without
  // the activation marker the second would commit at once, unable to see the
  // first link go pending, and both links would end up live.
  test('waits for an overlapping activation and then supersedes its link', async () => {
    const first = await insert()
    const second = await insert()
    const session = client.startSession()
    session.startTransaction(transactionOptions)
    await db
      .collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)
      .updateOne(
        { _id: 'activation:journey-1' },
        { $set: { windowEndsAt: NOW } },
        { upsert: true, session }
      )
    await records.updateOne(
      { _id: first._id },
      { $set: { status: STATUS.PENDING } },
      { session }
    )

    const activating = activateRecord(
      { client, db },
      { _id: second._id, journeyId: 'journey-1', now: LATER }
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    await session.commitTransaction()
    await session.endSession()
    await activating

    expect(await statusOf(first._id)).toBe(STATUS.SUPERSEDED)
    expect(await statusOf(second._id)).toBe(STATUS.PENDING)
  })

  test('leaves at most one live link when a journey’s links activate at once', async () => {
    const sent = await Promise.all(Array.from({ length: 10 }, () => insert()))

    await Promise.all(
      sent.map(({ _id }) =>
        activateRecord(
          { client, db },
          { _id, journeyId: 'journey-1', now: NOW }
        )
      )
    )

    expect(
      await records.countDocuments({
        journeyId: 'journey-1',
        status: STATUS.PENDING
      })
    ).toBe(1)
    expect(
      await records.countDocuments({
        journeyId: 'journey-1',
        status: STATUS.SUPERSEDED
      })
    ).toBe(9)
  })
})

describe('#markVerified', () => {
  const sendLink = async ({ now = NOW } = {}) => {
    const { tokenHash } = generateLinkToken()
    const { _id } = await insertSendingRecord(db, {
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash,
      now,
      settings
    })
    await activateRecord({ client, db }, { _id, journeyId: 'journey-1', now })
    return { _id, tokenHash }
  }

  test('marks a live link verified and returns it', async () => {
    const { _id, tokenHash } = await sendLink()

    const verified = await markVerified(db, { tokenHash, now: LATER })

    expect(verified).toMatchObject({
      _id,
      status: STATUS.VERIFIED,
      verifiedAt: LATER
    })
    expect(await findByTokenHash(db, tokenHash)).toEqual(verified)
  })

  test('returns null, changing nothing, for an expired link', async () => {
    const { _id, tokenHash } = await sendLink()

    expect(
      await markVerified(db, {
        tokenHash,
        now: new Date('2026-10-15T10:15:00.000Z')
      })
    ).toBeNull()
    expect(await statusOf(_id)).toBe(STATUS.PENDING)
  })

  test('returns null for a link that is still sending, superseded or used', async () => {
    const sending = await insert()
    const superseded = await sendLink()
    const used = await sendLink()
    await markVerified(db, { tokenHash: used.tokenHash, now: NOW })

    for (const { _id } of [sending, superseded, used]) {
      const { tokenHash } = await records.findOne({ _id })
      expect(await markVerified(db, { tokenHash, now: LATER })).toBeNull()
    }
    expect(await records.findOne({ _id: used._id })).toMatchObject({
      verifiedAt: NOW
    })
  })

  test('verifies a link only once when attempts run in parallel', async () => {
    const { tokenHash } = await sendLink()

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        markVerified(db, { tokenHash, now: LATER })
      )
    )

    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('#findLatestRecord', () => {
  test('returns null for a journey with no links', async () => {
    await insert('journey-2')

    expect(await findLatestRecord(db, 'journey-1')).toBeNull()
  })

  test('returns the newest sent link, skipping one still sending', async () => {
    await insertSendingRecord(db, {
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash: generateLinkToken().tokenHash,
      now: NOW,
      settings
    })
    const sent = await insertSendingRecord(db, {
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash: generateLinkToken().tokenHash,
      now: LATER,
      settings
    })
    await activateRecord(
      { client, db },
      { _id: sent._id, journeyId: 'journey-1', now: LATER }
    )
    await insertSendingRecord(db, {
      journeyId: 'journey-1',
      email: 'jane@example.com',
      tokenHash: generateLinkToken().tokenHash,
      now: new Date('2026-10-15T10:05:00.000Z'),
      settings
    })

    expect((await findLatestRecord(db, 'journey-1'))._id).toEqual(sent._id)
  })
})

describe('#findRecentVerification', () => {
  const verifiedRecord = async ({
    journeyId = 'journey-1',
    email = 'jane@example.com',
    verifiedAt = LATER
  } = {}) => {
    const { insertedId } = await records.insertOne({
      journeyId,
      email,
      tokenHash: generateLinkToken().tokenHash,
      status: STATUS.VERIFIED,
      createdAt: NOW,
      verifiedAt
    })
    return insertedId
  }

  test('finds the journey’s verification of the address made after `since`', async () => {
    const _id = await verifiedRecord()

    expect(
      (
        await findRecentVerification(db, {
          journeyId: 'journey-1',
          email: 'jane@example.com',
          since: NOW
        })
      )._id
    ).toEqual(_id)
  })

  test.each([
    ['another journey', { journeyId: 'journey-2' }],
    ['another address', { email: 'john@example.com' }],
    ['a verification at or before `since`', { verifiedAt: NOW }]
  ])('ignores %s', async (_label, overrides) => {
    await verifiedRecord(overrides)

    expect(
      await findRecentVerification(db, {
        journeyId: 'journey-1',
        email: 'jane@example.com',
        since: NOW
      })
    ).toBeNull()
  })
})
