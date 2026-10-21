import {
  EMAIL_VERIFICATIONS_COLLECTION,
  EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION
} from '#/common/constants/collections.js'
import { withTransaction } from '#/repositories/mongo-transaction.js'

export const STATUS = {
  SENDING: 'sending',
  PENDING: 'pending',
  VERIFIED: 'verified',
  SUPERSEDED: 'superseded'
}

const MS_PER_SECOND = 1000

const records = (db) => db.collection(EMAIL_VERIFICATIONS_COLLECTION)

const addSeconds = (date, seconds) =>
  new Date(date.getTime() + seconds * MS_PER_SECOND)

// A new link starts as `sending`, which verify ignores, so it can't be used
// until the email has gone. If the send fails the record is deleted; if the
// process dies first, the TTL index purges it.
export async function insertSendingRecord(
  db,
  { journeyId, email, tokenHash, now, settings }
) {
  const expiresAt = addSeconds(now, settings.linkTtlSeconds)
  const { insertedId } = await records(db).insertOne({
    journeyId,
    email,
    tokenHash,
    status: STATUS.SENDING,
    createdAt: now,
    expiresAt,
    verifiedAt: null,
    supersededAt: null,
    purgeAt: addSeconds(now, settings.recordRetentionSeconds)
  })
  return { _id: insertedId, expiresAt }
}

export function deleteSendingRecord(db, _id) {
  return records(db).deleteOne({ _id, status: STATUS.SENDING })
}

// Once the email has gone, supersede the journey's other pending links and make
// this one pending, together. Under snapshot isolation two activations for the
// same journey would each miss the other's new link, so both first write the
// journey's activation marker: the second then conflicts, and the driver
// retries it after the first commits. At most one link is ever live.
export function activateRecord({ client, db }, { _id, journeyId, now }) {
  return withTransaction(client, async (session) => {
    await db.collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION).updateOne(
      { _id: `activation:${journeyId}` },
      // Only needed for this transaction; the TTL index clears it.
      { $set: { windowEndsAt: now } },
      { upsert: true, session }
    )

    await records(db).updateMany(
      { journeyId, status: STATUS.PENDING, _id: { $ne: _id } },
      { $set: { status: STATUS.SUPERSEDED, supersededAt: now } },
      { session }
    )

    const { modifiedCount } = await records(db).updateOne(
      { _id, status: STATUS.SENDING },
      { $set: { status: STATUS.PENDING } },
      { session }
    )
    if (modifiedCount !== 1) {
      throw new Error('Verification record is no longer sending')
    }
  })
}

// Uses up a link in one atomic update, so of any number of concurrent attempts
// exactly one succeeds. Resolves to the verified record, or null if the link
// is unknown, not yet sent, expired, superseded or already used.
export function markVerified(db, { tokenHash, now }) {
  return records(db).findOneAndUpdate(
    { tokenHash, status: STATUS.PENDING, expiresAt: { $gt: now } },
    { $set: { status: STATUS.VERIFIED, verifiedAt: now } },
    { returnDocument: 'after' }
  )
}

export function findByTokenHash(db, tokenHash) {
  return records(db).findOne({ tokenHash })
}

// The journey's most recent link that was actually sent. A `sending` record is
// skipped: until its email has gone, the earlier link is still the live one.
export function findLatestRecord(db, journeyId) {
  return records(db).findOne(
    { journeyId, status: { $ne: STATUS.SENDING } },
    { sort: { createdAt: -1 } }
  )
}

// The journey's latest verification of `email` made after `since`, or null.
export function findRecentVerification(db, { journeyId, email, since }) {
  return records(db).findOne(
    {
      journeyId,
      email,
      status: STATUS.VERIFIED,
      verifiedAt: { $gt: since }
    },
    { sort: { createdAt: -1 } }
  )
}
