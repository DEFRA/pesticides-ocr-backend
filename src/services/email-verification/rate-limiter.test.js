import { MongoClient } from 'mongodb'
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'

import { EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION } from '#/common/constants/collections.js'
import {
  LIMITS,
  releaseSend,
  reserveSend
} from '#/services/email-verification/rate-limiter.js'

const settings = {
  resendCooldownSeconds: 60,
  maxSendsPerEmailPerHour: 3,
  maxSendsPerJourneyPerHour: 3,
  maxSendsGlobalPerHour: 10
}

// 10:00:00 is the start of a window, so tests can step within and past it.
const WINDOW_START = new Date('2026-10-15T10:00:00.000Z')
const at = (seconds) => new Date(WINDOW_START.getTime() + seconds * 1000)
const WINDOW = WINDOW_START.getTime()

let client
let db
let rateLimits

beforeAll(async () => {
  client = await MongoClient.connect(process.env.MONGO_URI)
  db = client.db('email-verification-rate-limiter-test')
  rateLimits = db.collection(EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION)
})

beforeEach(async () => {
  await db.dropDatabase()
})

afterAll(async () => {
  await db.dropDatabase()
  await client.close()
})

const reserve = ({
  journeyId = 'journey-1',
  emailHash = 'email-1',
  now = at(0),
  limits = settings
} = {}) => reserveSend(db, { journeyId, emailHash, now, settings: limits })

const count = async (_id) => (await rateLimits.findOne({ _id }))?.count ?? 0

// Every counter that still holds a send, by bucket.
const heldCounts = async () =>
  (
    await rateLimits
      .find({ count: { $gt: 0 } })
      .sort({ _id: 1 })
      .toArray()
  ).map(({ _id, count }) => ({ _id, count }))

describe('#reserveSend', () => {
  test('allows the first send and counts it in every bucket', async () => {
    const result = await reserve()

    expect(result).toEqual({
      allowed: true,
      reservation: expect.any(Object),
      resendAvailableAt: at(60)
    })
    expect(await count(`email:email-1:${WINDOW}`)).toBe(1)
    expect(await count(`journey:journey-1:${WINDOW}`)).toBe(1)
    expect(await count(`global:${WINDOW}`)).toBe(1)
  })

  test('keys the email counter by the hash it is given', async () => {
    await reserve({ emailHash: 'f'.repeat(64) })

    expect(await count(`email:${'f'.repeat(64)}:${WINDOW}`)).toBe(1)
  })

  test('sets each counter to expire at the end of its window', async () => {
    await reserve({ now: at(125) })

    const counter = await rateLimits.findOne({ _id: `global:${WINDOW}` })
    expect(counter.windowEndsAt).toEqual(at(3600))
  })

  describe('cooldown', () => {
    test('refuses a second send for the journey within the cooldown', async () => {
      await reserve()

      const result = await reserve({ now: at(15), emailHash: 'email-2' })

      expect(result).toEqual({
        allowed: false,
        limit: LIMITS.COOLDOWN,
        retryAfterSeconds: 45
      })
    })

    test('does not count a send refused by the cooldown', async () => {
      await reserve()
      await reserve({ now: at(15) })

      expect(await heldCounts()).toEqual([
        { _id: `email:email-1:${WINDOW}`, count: 1 },
        { _id: `global:${WINDOW}`, count: 1 },
        { _id: `journey:journey-1:${WINDOW}`, count: 1 }
      ])
    })

    test('allows the journey to send again once the cooldown has passed', async () => {
      await reserve()

      const result = await reserve({ now: at(60) })

      expect(result.allowed).toBe(true)
      expect(result.resendAvailableAt).toEqual(at(120))
    })

    test('does not hold back other journeys', async () => {
      await reserve()

      const result = await reserve({ journeyId: 'journey-2', now: at(1) })

      expect(result.allowed).toBe(true)
    })

    test('lets exactly one of many concurrent sends for a journey through', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          reserve({ emailHash: `email-${i}` })
        )
      )

      expect(results.filter(({ allowed }) => allowed)).toHaveLength(1)
      expect(
        results.filter(({ limit }) => limit === LIMITS.COOLDOWN)
      ).toHaveLength(9)
      expect(await count(`global:${WINDOW}`)).toBe(1)
    })
  })

  // nthRequest(i) varies whatever the other limits key on, so only the cap
  // under test is reached. The journey cap's requests are spaced past the
  // cooldown.
  describe.each([
    [
      LIMITS.EMAIL,
      'maxSendsPerEmailPerHour',
      (i) => ({ journeyId: `journey-${i}`, now: at(i) })
    ],
    [
      LIMITS.JOURNEY,
      'maxSendsPerJourneyPerHour',
      (i) => ({ emailHash: `email-${i}`, now: at(i * 61) })
    ],
    [
      LIMITS.GLOBAL,
      'maxSendsGlobalPerHour',
      (i) => ({
        journeyId: `journey-${i}`,
        emailHash: `email-${i}`,
        now: at(i)
      })
    ]
  ])('%s cap', (limit, settingName, nthRequest) => {
    const max = settings[settingName]
    const sendUpToCap = async () => {
      for (let i = 0; i < max; i++) {
        expect((await reserve(nthRequest(i))).allowed).toBe(true)
      }
    }
    const lastSendAt = nthRequest(max - 1).now
    const nextRequest = () => ({
      ...nthRequest(max),
      now: new Date(lastSendAt.getTime() + 61_000)
    })

    test(`allows ${max} sends, then refuses until the window ends`, async () => {
      await sendUpToCap()
      const { now } = nextRequest()

      const result = await reserve(nextRequest())

      expect(result).toEqual({
        allowed: false,
        limit,
        retryAfterSeconds: (at(3600).getTime() - now.getTime()) / 1000
      })
    })

    test('gives back its counters and its cooldown when it refuses', async () => {
      await sendUpToCap()
      const before = await heldCounts()

      await reserve(nextRequest())

      expect(await heldCounts()).toEqual(before)
      const { journeyId = 'journey-1' } = nextRequest()
      expect(
        await rateLimits.findOne({ _id: `cooldown:${journeyId}` })
      ).toBeNull()
    })

    test('allows sends again when the next window starts', async () => {
      await sendUpToCap()

      const result = await reserve({ ...nthRequest(max), now: at(3600) })

      expect(result.allowed).toBe(true)
    })
  })

  // A refused send holds its count until it gives it back, so a burst can let
  // fewer than the cap through, but never more.
  test('never lets concurrent sends past a cap, and counts only those allowed', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        reserve({ journeyId: `journey-${i}` })
      )
    )

    const allowed = results.filter((result) => result.allowed).length
    expect(allowed).toBeGreaterThan(0)
    expect(allowed).toBeLessThanOrEqual(3)
    expect(await count(`email:email-1:${WINDOW}`)).toBe(allowed)
    expect(await count(`global:${WINDOW}`)).toBe(allowed)
  })

  test('counts sends to different addresses separately', async () => {
    for (let i = 0; i < 3; i++) {
      await reserve({ journeyId: `journey-${i}` })
    }

    const result = await reserve({
      journeyId: 'another-journey',
      emailHash: 'email-2'
    })

    expect(result.allowed).toBe(true)
  })
})

describe('#releaseSend', () => {
  test('gives back the counters and clears the cooldown', async () => {
    const { reservation } = await reserve()

    await releaseSend(db, reservation)

    expect(await heldCounts()).toEqual([])
    expect((await reserve({ now: at(1) })).allowed).toBe(true)
  })

  test('leaves a later request’s cooldown in place', async () => {
    const { reservation } = await reserve()
    await rateLimits.deleteOne({ _id: 'cooldown:journey-1' })
    await reserve({ now: at(1) })

    await releaseSend(db, reservation)

    expect((await reserve({ now: at(2) })).limit).toBe(LIMITS.COOLDOWN)
  })

  test('never takes a counter below zero', async () => {
    const { reservation } = await reserve()

    await releaseSend(db, reservation)
    await releaseSend(db, reservation)

    const counts = (await rateLimits.find().toArray()).map(({ count }) => count)
    expect(counts).toEqual([0, 0, 0])
  })
})
