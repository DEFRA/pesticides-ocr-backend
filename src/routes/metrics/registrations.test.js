import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { SignJWT } from 'jose'

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

// Registrations across three months so per-month + total can be asserted.
const docs = [
  { reference: 'PPP-A1B-2C3', submittedAt: new Date('2026-03-11T09:30:00Z') },
  { reference: 'PPP-D4E-5F6', submittedAt: new Date('2026-03-20T12:00:00Z') },
  { reference: 'PPP-G7H-8I9', submittedAt: new Date('2026-05-02T10:00:00Z') }
]

describe('#metricsRoutes — GET /metrics/registrations', () => {
  let server
  let officerToken
  let viewerToken

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb.
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
    await server.db
      .collection('ocr-registration')
      .insertMany(docs.map((doc) => ({ ...doc })))
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
    expect((await get('/metrics/registrations')).statusCode).toBe(401)
  })

  test('403 for a token without the case_officer role', async () => {
    expect((await get('/metrics/registrations', viewerToken)).statusCode).toBe(
      403
    )
  })

  test('200 returns the total and a per-month series', async () => {
    const { statusCode, result } = await get(
      '/metrics/registrations',
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
      '/metrics/registrations?from=2026-04-01&to=2026-12-31',
      officerToken
    )
    expect(result.total).toBe(1)
    expect(result.byMonth).toEqual([{ month: '2026-05', count: 1 }])
  })

  test('applies a from-only bound', async () => {
    const { result } = await get(
      '/metrics/registrations?from=2026-04-01',
      officerToken
    )
    expect(result.total).toBe(1) // only the May registration
  })

  test('applies a to-only bound', async () => {
    const { result } = await get(
      '/metrics/registrations?to=2026-04-01',
      officerToken
    )
    expect(result.total).toBe(2) // the two March registrations
  })

  test('a bare `to` date includes same-day submissions (inclusive end of day)', async () => {
    // The 2026-03-20 registration is at 12:00 — a naive midnight $lte would
    // exclude it; the inclusive end-of-day bound must include it.
    const { result } = await get(
      '/metrics/registrations?to=2026-03-20',
      officerToken
    )
    expect(result.total).toBe(2)
  })

  test('400 for an unknown query parameter', async () => {
    expect(
      (await get('/metrics/registrations?foo=bar', officerToken)).statusCode
    ).toBe(400)
  })

  test('returns zeros when the range matches nothing', async () => {
    const { statusCode, result } = await get(
      '/metrics/registrations?from=2020-01-01&to=2020-12-31',
      officerToken
    )
    expect(statusCode).toBe(200)
    expect(result).toEqual({ total: 0, byMonth: [] })
  })

  test('400 for an invalid date', async () => {
    expect(
      (await get('/metrics/registrations?from=not-a-date', officerToken))
        .statusCode
    ).toBe(400)
  })
})
