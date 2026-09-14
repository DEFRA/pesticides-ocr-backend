import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { SignJWT } from 'jose'

import { JOURNEY_STARTS_COLLECTION } from '#/services/metrics/metrics.js'

// Mock-mode tokens (ENVIRONMENT defaults to local under test): decoded but not
// signature-verified. Mint tokens with/without the case-officer role.
function mockToken(roles) {
  return new SignJWT({ name: 'Test Officer', roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('officer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

// Starts across two months so per-month + total can be asserted. One is at
// 12:00 to exercise the inclusive end-of-day bound (as in the registrations test).
const starts = [
  { startedAt: new Date('2026-03-01T09:00:00Z') },
  { startedAt: new Date('2026-03-20T12:00:00Z') },
  { startedAt: new Date('2026-05-05T08:00:00Z') }
]

describe('#metricsRoutes — journey starts', () => {
  let server
  let officerToken
  let viewerToken

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb.
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
    // Deterministic regardless of what other test files leave behind.
    await server.db.collection(JOURNEY_STARTS_COLLECTION).deleteMany({})
    await server.db
      .collection(JOURNEY_STARTS_COLLECTION)
      .insertMany(starts.map((doc) => ({ ...doc })))
    officerToken = await mockToken(['case_officer'])
    viewerToken = await mockToken(['viewer'])
  })

  afterAll(async () => {
    await server.stop()
  })

  function get(url, token) {
    return server.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
  }

  describe('POST /metrics/journey-starts (public beacon)', () => {
    test('records a start with no token and returns 204', async () => {
      const marker = new Date()
      const before = await server.db
        .collection(JOURNEY_STARTS_COLLECTION)
        .countDocuments()

      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/metrics/journey-starts'
      })

      expect(statusCode).toBe(204)
      const after = await server.db
        .collection(JOURNEY_STARTS_COLLECTION)
        .countDocuments()
      expect(after).toBe(before + 1)

      // Remove the beacon-recorded (now-dated) doc so the seeded past-dated set
      // stays pristine for the GET total / range assertions below.
      await server.db
        .collection(JOURNEY_STARTS_COLLECTION)
        .deleteMany({ startedAt: { $gte: marker } })
    })

    test('stays public — still 204 even with an Authorization header', async () => {
      // Regression guard: an accidental future `auth:` addition (or a default
      // strategy) would turn this into a 401 for a bad token. It must not.
      const marker = new Date()

      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/metrics/journey-starts',
        headers: { authorization: 'Bearer not-a-real-token' }
      })

      expect(statusCode).toBe(204)
      await server.db
        .collection(JOURNEY_STARTS_COLLECTION)
        .deleteMany({ startedAt: { $gte: marker } })
    })
  })

  describe('GET /metrics/journey-starts', () => {
    test('401 when no bearer token is presented', async () => {
      expect((await get('/metrics/journey-starts')).statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      expect(
        (await get('/metrics/journey-starts', viewerToken)).statusCode
      ).toBe(403)
    })

    test('200 returns the total and a per-month series', async () => {
      const { statusCode, result } = await get(
        '/metrics/journey-starts',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(result.total).toBe(3)
      expect(result.byMonth).toEqual([
        { month: '2026-03', count: 2 },
        { month: '2026-05', count: 1 }
      ])
    })

    test('applies a from/to date range', async () => {
      const { result } = await get(
        '/metrics/journey-starts?from=2026-04-01&to=2026-12-31',
        officerToken
      )
      expect(result.total).toBe(1)
      expect(result.byMonth).toEqual([{ month: '2026-05', count: 1 }])
    })

    test('a bare `to` date includes same-day starts (inclusive end of day)', async () => {
      // The 2026-03-20 start is at 12:00 — a naive midnight $lte would exclude
      // it; the inclusive end-of-day bound must include it.
      const { result } = await get(
        '/metrics/journey-starts?to=2026-03-20',
        officerToken
      )
      expect(result.total).toBe(2)
    })

    test('400 for an unknown query parameter', async () => {
      expect(
        (await get('/metrics/journey-starts?foo=bar', officerToken)).statusCode
      ).toBe(400)
    })

    test('returns zeros when the range matches nothing', async () => {
      const { statusCode, result } = await get(
        '/metrics/journey-starts?from=2020-01-01&to=2020-12-31',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(result).toEqual({ total: 0, byMonth: [] })
    })

    test('400 for an invalid date', async () => {
      expect(
        (await get('/metrics/journey-starts?from=not-a-date', officerToken))
          .statusCode
      ).toBe(400)
    })
  })
})
