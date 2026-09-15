import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

// Force both beacons' writes to fail so the shared beaconRoute error branch
// (try/catch → Boom.internal → 500) is covered for each caller. Keep every other
// export real: server startup (createIndexes) needs the collection constants and
// the GET routes need the real count functions.
vi.mock('#/services/metrics/metrics.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    recordJourneyStart: vi.fn().mockRejectedValue(new Error('db unavailable')),
    recordJourneyNotEligible: vi
      .fn()
      .mockRejectedValue(new Error('db unavailable'))
  }
})

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
