import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

// Force both beacons' writes to fail so the shared beaconRoute error branch
// (try/catch → Boom.internal → 500) is covered for each caller. Only the two
// write controllers are mocked; the read controllers and server startup
// (createIndexes) keep using the real modules.
vi.mock(
  '#/services/metrics/journey-start-events/journey-start-events.js',
  () => ({
    recordJourneyStart: vi.fn().mockRejectedValue(new Error('db unavailable'))
  })
)

vi.mock(
  '#/services/metrics/journey-not-eligible-events/journey-not-eligible-events.js',
  () => ({
    recordJourneyNotEligible: vi
      .fn()
      .mockRejectedValue(new Error('db unavailable'))
  })
)

describe('#metricsRoutes — beacon failure', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test.each(['/metrics/journey-starts', '/metrics/journey-not-eligible'])(
    'POST %s returns 500 when the event cannot be recorded',
    async (path) => {
      const { statusCode } = await server.inject({ method: 'POST', url: path })
      expect(statusCode).toBe(500)
    }
  )
})
