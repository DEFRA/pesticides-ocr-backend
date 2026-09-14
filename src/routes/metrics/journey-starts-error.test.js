import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

// Force the beacon's write to fail so the POST error branch (try/catch →
// Boom.internal → 500) is covered, mirroring registration.test.js's approach.
// Keep every other export real: server startup (createIndexes) needs
// JOURNEY_STARTS_COLLECTION and the GET routes need the real count functions.
vi.mock('#/services/metrics/metrics.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    recordJourneyStart: vi.fn().mockRejectedValue(new Error('db unavailable'))
  }
})

describe('#metricsRoutes — POST /metrics/journey-starts (failure)', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('returns 500 when the start cannot be recorded', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/metrics/journey-starts'
    })
    expect(statusCode).toBe(500)
  })
})
