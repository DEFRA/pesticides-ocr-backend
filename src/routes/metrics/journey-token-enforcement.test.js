import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'

import { config } from '#/config.js'
import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION
} from '#/services/metrics/metrics.js'

// When journeyToken.secret is set, both public beacons must carry a valid signed
// token. Verify enforcement, rejection, and replay idempotency for each.
const SECRET = 'shared-test-secret'
const signedToken = (nonce) =>
  `${nonce}.${createHmac('sha256', SECRET).update(nonce).digest('hex')}`

const cases = [
  { label: 'journey starts', path: '/metrics/journey-starts', collection: JOURNEY_STARTS_COLLECTION },
  {
    label: 'journey not-eligible finishes',
    path: '/metrics/journey-not-eligible',
    collection: JOURNEY_NOT_ELIGIBLE_COLLECTION
  }
]

describe.each(cases)(
  '#metricsRoutes — beacon token enforcement ($label)',
  ({ path, collection }) => {
    let server

    beforeAll(async () => {
      const { createServer } = await import('#/server.js')
      server = await createServer()
      await server.initialize()
      config.set('journeyToken.secret', SECRET)
      await server.db.collection(collection).deleteMany({})
    })

    afterAll(async () => {
      config.set('journeyToken.secret', '')
      await server.stop()
    })

    function post(token) {
      return server.inject({
        method: 'POST',
        url: path,
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

      // request.log(['metrics'], ...) surfaces on the server 'request' event.
      const metricsLogs = []
      const onRequest = (_request, event) => {
        if (event.tags?.includes('metrics')) {
          metricsLogs.push(event)
        }
      }
      server.events.on('request', onRequest)

      expect((await post(token)).statusCode).toBe(204)
      const afterFirst = await server.db.collection(collection).countDocuments()
      expect(afterFirst).toBe(1)
      expect(metricsLogs).toHaveLength(1) // logged the actual record

      // Replaying the same token must not add a second document — nor log again.
      expect((await post(token)).statusCode).toBe(204)
      const afterReplay = await server.db.collection(collection).countDocuments()
      expect(afterReplay).toBe(1)
      expect(metricsLogs).toHaveLength(1)

      server.events.removeListener('request', onRequest)
    })
  }
)
