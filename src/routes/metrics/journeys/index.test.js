import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { SignJWT } from 'jose'

import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  OCR_REGISTRATION_COLLECTION
} from '#/common/constants/collections.js'

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

const at = (iso) => new Date(`${iso}T10:00:00Z`)

// A December 2025 start that never finishes, starts in March and April 2026,
// and a May registration with no start that month, as when a journey starts on
// the last day of one month and finishes the next.
const starts = [
  '2025-12-30',
  '2026-03-02',
  '2026-03-03',
  '2026-03-04',
  '2026-03-05',
  '2026-04-01',
  '2026-04-02'
].map((day) => ({ startedAt: at(day) }))
const registrations = [
  '2026-03-10',
  '2026-03-11',
  '2026-04-03',
  '2026-05-01'
].map((day, i) => ({ reference: `PPP-AAA-00${i}`, submittedAt: at(day) }))
const notEligible = [{ endedAt: at('2026-03-06') }]

const figures = (
  starts,
  registrations,
  notEligible,
  dropOuts,
  completionRate,
  registrationRate
) => ({
  starts,
  registrations,
  notEligible,
  finished: registrations + notEligible,
  dropOuts,
  completionRate,
  registrationRate
})

describe('#metricsRoutes — GET /metrics/journeys', () => {
  let server
  let officerToken
  let viewerToken

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb.
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
    await server.db.collection(JOURNEY_STARTS_COLLECTION).insertMany(starts)
    await server.db
      .collection(OCR_REGISTRATION_COLLECTION)
      .insertMany(registrations)
    await server.db
      .collection(JOURNEY_NOT_ELIGIBLE_COLLECTION)
      .insertMany(notEligible)
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

  test('401 when no bearer token is presented', async () => {
    expect((await get('/metrics/journeys')).statusCode).toBe(401)
  })

  test('403 for a token without the case_officer role', async () => {
    expect((await get('/metrics/journeys', viewerToken)).statusCode).toBe(403)
  })

  test('counts both end points as finished in the completion rate', async () => {
    const { statusCode, result } = await get('/metrics/journeys', officerToken)

    expect(statusCode).toBe(200)
    expect(result).toMatchObject(figures(7, 4, 1, 2, 0.7143, 0.5714))
  })

  test('gives the same figures per year', async () => {
    const { result } = await get('/metrics/journeys', officerToken)

    expect(result.byYear).toEqual([
      { year: '2025', ...figures(1, 0, 0, 1, 0, 0) },
      { year: '2026', ...figures(6, 4, 1, 1, 0.8333, 0.6667) }
    ])
  })

  test('gives the same figures per month, with drop-outs never below zero', async () => {
    const { result } = await get('/metrics/journeys', officerToken)

    expect(result.byMonth).toEqual([
      { month: '2025-12', ...figures(1, 0, 0, 1, 0, 0) },
      { month: '2026-03', ...figures(4, 2, 1, 1, 0.75, 0.5) },
      { month: '2026-04', ...figures(2, 1, 0, 1, 0.5, 0.5) },
      { month: '2026-05', ...figures(0, 1, 0, 0, null, null) }
    ])
  })

  test('applies a from/to date range to every figure', async () => {
    const { result } = await get(
      '/metrics/journeys?from=2026-04-01&to=2026-04-30',
      officerToken
    )

    expect(result).toEqual({
      ...figures(2, 1, 0, 1, 0.5, 0.5),
      byYear: [{ year: '2026', ...figures(2, 1, 0, 1, 0.5, 0.5) }],
      byMonth: [{ month: '2026-04', ...figures(2, 1, 0, 1, 0.5, 0.5) }]
    })
  })

  test('a period with no journeys has no rates', async () => {
    const { result } = await get(
      '/metrics/journeys?from=2027-01-01',
      officerToken
    )

    expect(result).toEqual({
      ...figures(0, 0, 0, 0, null, null),
      byYear: [],
      byMonth: []
    })
  })

  test('400 for an invalid date', async () => {
    expect(
      (await get('/metrics/journeys?from=not-a-date', officerToken)).statusCode
    ).toBe(400)
  })
})
