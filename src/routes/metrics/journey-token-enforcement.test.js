import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'

import { config } from '#/config.js'
import { JOURNEY_STARTS_COLLECTION } from '#/services/metrics/metrics.js'

// When metrics.journeyTokenSecret is set, the public beacons must carry a valid
// signed token. Verify enforcement, rejection, and replay idempotency.
const SECRET = 'shared-test-secret'
const signedToken = (nonce) =>
  `${nonce}.${createHmac('sha256', SECRET).update(nonce).digest('hex')}`

describe('#metricsRoutes — beacon token enforcement', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
    config.set('metrics.journeyTokenSecret', SECRET)
    await server.db.collection(JOURNEY_STARTS_COLLECTION).deleteMany({})
  })

  afterAll(async () => {
    config.set('metrics.journeyTokenSecret', '')
    await server.stop()
  })

  function post(token) {
    return server.inject({
      method: 'POST',
      url: '/metrics/journey-starts',
      headers: token ? { 'x-journey-token': token } : {}
    })
  }

  test('401 when the token is missing', async () => {
    expect((await post()).statusCode).toBe(401)
  })

  test('401 when the signature is invalid', async () => {
    expect((await post('session-x.deadbeef')).statusCode).toBe(401)
  })

  test('records once for a valid token; a replay is an idempotent no-op', async () => {
    const token = signedToken('session-nonce-1')

    expect((await post(token)).statusCode).toBe(204)
    const afterFirst = await server.db
      .collection(JOURNEY_STARTS_COLLECTION)
      .countDocuments()
    expect(afterFirst).toBe(1)

    // Replaying the same token must not add a second document.
    expect((await post(token)).statusCode).toBe(204)
    const afterReplay = await server.db
      .collection(JOURNEY_STARTS_COLLECTION)
      .countDocuments()
    expect(afterReplay).toBe(1)
  })
})
