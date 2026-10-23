import { randomUUID } from 'node:crypto'

import { EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION } from '#/common/constants/collections.js'
import { RATE_LIMITS } from '#/common/constants/email-verification.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { MS_PER_SECOND } from '#/common/helpers/time.js'

// Fixed-window limits on verification emails, shared by every instance through
// Mongo. Each counter is one document per bucket per hour,
// { _id: '<limit>:<key>:<windowStart>', count, windowEndsAt }, so a new window
// starts from a new document and the TTL index on windowEndsAt clears old ones.
// The cooldown is one document per journey, { _id: 'cooldown:<journeyId>',
// windowEndsAt, claimId }, claimed atomically. No per-IP limit: CDP doesn't
// expose the client IP.

// Re-exported for existing imports; the canonical definition lives in
// common/constants/email-verification.js.
export const LIMITS = RATE_LIMITS

const WINDOW_MS = 60 * 60 * MS_PER_SECOND

const rateLimits = (db) =>
  db.collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)

const secondsUntil = (date, now) =>
  Math.max(1, Math.ceil((date.getTime() - now.getTime()) / MS_PER_SECOND))

const isDuplicateKey = (error) => error.code === MONGO_DUPLICATE_KEY_ERROR

// Two first requests in a window can both try to insert the counter; the loser
// gets a duplicate key error, and trying again increments the winner's.
async function retryOnDuplicateKey(operation) {
  try {
    return await operation()
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error
    }
    return operation()
  }
}

// Sets the journey's cooldown unless one is already running. The filter only
// matches an expired cooldown, so while one runs the upsert tries to insert a
// second document with the same _id and fails: that failure is the refusal.
async function claimCooldown(db, journeyId, now, cooldownSeconds) {
  const _id = `${LIMITS.COOLDOWN}:${journeyId}`
  const claimId = randomUUID()
  const endsAt = new Date(now.getTime() + cooldownSeconds * MS_PER_SECOND)

  try {
    await rateLimits(db).updateOne(
      { _id, windowEndsAt: { $lte: now } },
      { $set: { windowEndsAt: endsAt, claimId } },
      { upsert: true }
    )
    return { claimed: true, key: { _id, claimId }, endsAt }
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error
    }
    const running = await rateLimits(db).findOne({ _id })
    return { claimed: false, endsAt: running?.windowEndsAt ?? now }
  }
}

function counterBuckets({ journeyId, emailHash, windowStart, settings }) {
  return [
    {
      limit: LIMITS.EMAIL,
      _id: `${LIMITS.EMAIL}:${emailHash}:${windowStart}`,
      max: settings.maxSendsPerEmailPerHour
    },
    {
      limit: LIMITS.JOURNEY,
      _id: `${LIMITS.JOURNEY}:${journeyId}:${windowStart}`,
      max: settings.maxSendsPerJourneyPerHour
    },
    {
      limit: LIMITS.GLOBAL,
      _id: `${LIMITS.GLOBAL}:${windowStart}`,
      max: settings.maxSendsGlobalPerHour
    }
  ]
}

function increment(db, _id, windowEndsAt) {
  return retryOnDuplicateKey(() =>
    rateLimits(db).findOneAndUpdate(
      { _id },
      { $inc: { count: 1 }, $setOnInsert: { windowEndsAt } },
      { upsert: true, returnDocument: 'after' }
    )
  )
}

// Gives back what reserveSend took, so a refused or failed request uses up no
// quota and doesn't start a cooldown. The cooldown is only cleared if it is
// still this request's claim.
export async function releaseSend(db, { cooldownKey, counterIds }) {
  await Promise.all([
    ...(cooldownKey ? [rateLimits(db).deleteOne(cooldownKey)] : []),
    ...counterIds.map((_id) =>
      rateLimits(db).updateOne(
        { _id, count: { $gt: 0 } },
        { $inc: { count: -1 } }
      )
    )
  ])
}

// Reserves one verification email for the journey and address: first the
// cooldown, then the email, journey and global counters. Each step is a single
// atomic update, so concurrent requests can't overshoot a limit. Resolves to
// { allowed: true, reservation, resendAvailableAt } or
// { allowed: false, limit, retryAfterSeconds }; `limit` is for internal use only.
export async function reserveSend(db, { journeyId, emailHash, now, settings }) {
  const cooldown = await claimCooldown(
    db,
    journeyId,
    now,
    settings.resendCooldownSeconds
  )
  if (!cooldown.claimed) {
    return {
      allowed: false,
      limit: LIMITS.COOLDOWN,
      retryAfterSeconds: secondsUntil(cooldown.endsAt, now)
    }
  }

  const windowStart = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS
  const windowEndsAt = new Date(windowStart + WINDOW_MS)
  const buckets = counterBuckets({
    journeyId,
    emailHash,
    windowStart,
    settings
  })

  const results = await Promise.allSettled(
    buckets.map(({ _id }) => increment(db, _id, windowEndsAt))
  )
  const reservation = {
    cooldownKey: cooldown.key,
    counterIds: buckets
      .filter((_bucket, i) => results[i].status === 'fulfilled')
      .map(({ _id }) => _id)
  }

  const failure = results.find(({ status }) => status === 'rejected')
  if (failure) {
    await releaseSend(db, reservation)
    throw failure.reason
  }

  const exceeded = buckets.find(({ max }, i) => results[i].value.count > max)
  if (exceeded) {
    await releaseSend(db, reservation)
    return {
      allowed: false,
      limit: exceeded.limit,
      retryAfterSeconds: secondsUntil(windowEndsAt, now)
    }
  }

  return { allowed: true, reservation, resendAvailableAt: cooldown.endsAt }
}
