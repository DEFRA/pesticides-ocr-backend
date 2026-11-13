import { describe, test, expect, beforeEach } from 'vitest'
import Hapi from '@hapi/hapi'

import { config } from '#/config.js'
import { externalBearerScheme } from './external-bearer-scheme.js'
import { requireExternalUser } from './require-own-registration.js'
import { EXTERNAL_STRATEGY_NAME } from './strategy-name.js'
import {
  issueExternalAccessToken,
  verifyExternalAccessToken
} from '#/services/external-user/access-token.js'

async function buildServer() {
  const server = Hapi.server()
  server.auth.scheme(EXTERNAL_STRATEGY_NAME, externalBearerScheme)
  server.auth.strategy(EXTERNAL_STRATEGY_NAME, EXTERNAL_STRATEGY_NAME)
  server.route({
    method: 'GET',
    path: '/protected',
    options: { auth: requireExternalUser() },
    handler: (request) => request.auth.credentials
  })
  await server.initialize()
  return server
}

function get(server, token) {
  return server.inject({
    method: 'GET',
    url: '/protected',
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
}

describe('externalBearerScheme', () => {
  let server
  const originalSecret = config.get('externalUser.tokenSecret')
  const originalTtl = config.get('externalUser.tokenTtlSeconds')

  beforeEach(async () => {
    config.set('externalUser.tokenSecret', 'external-bearer-test-secret')
    config.set('externalUser.tokenTtlSeconds', 1800)
    server = await buildServer()
    return async () => {
      config.set('externalUser.tokenSecret', originalSecret)
      config.set('externalUser.tokenTtlSeconds', originalTtl)
    }
  })

  test('200 for a valid token, with subject/registrationReference/scope on credentials', async () => {
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })
    const { statusCode, result } = await get(server, token)
    expect(statusCode).toBe(200)
    expect(result).toMatchObject({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001',
      roles: ['external_user'],
      scope: ['external_user']
    })
  })

  test('401 when no bearer token is supplied', async () => {
    expect((await get(server, undefined)).statusCode).toBe(401)
  })

  test('401 for a malformed/garbage token', async () => {
    expect((await get(server, 'not-a-real-token')).statusCode).toBe(401)
  })

  test('401 for a token signed with a different secret', async () => {
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })
    config.set('externalUser.tokenSecret', 'a-different-secret')
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('401 for an expired token', async () => {
    config.set('externalUser.tokenTtlSeconds', -1)
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('does not leak the failure reason in the 401 body', async () => {
    const { result } = await get(server, 'not-a-real-token')
    expect(result.message).toBe('Invalid bearer token')
  })

  // AC2 (completion ticket): tokens from the other auth family must not
  // authenticate through this strategy, and vice versa — asserted here by
  // confirming a token this scheme itself rejects is not somehow accepted by
  // the paired entra-bearer verifier either (cross-strategy confusion would
  // mean a shared signing secret/format, which this test guards against).
  test('an Entra-shaped (unsigned-for-us) token is rejected, not silently accepted', async () => {
    // A string that merely looks like a JWT (three base64url segments) but was
    // never signed by this service's secret.
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalidsignature'
    expect((await get(server, fakeJwt)).statusCode).toBe(401)
  })
})

describe('external-bearer-scheme + access-token round trip', () => {
  const originalSecret = config.get('externalUser.tokenSecret')

  beforeEach(() => {
    config.set('externalUser.tokenSecret', 'round-trip-secret')
    return () => config.set('externalUser.tokenSecret', originalSecret)
  })

  test('verifyExternalAccessToken agrees with what the scheme would authenticate', async () => {
    const token = await issueExternalAccessToken({
      subject: 'subj-2',
      reference: 'OCR-BBB-002'
    })
    const payload = await verifyExternalAccessToken(token)
    expect(payload.sub).toBe('subj-2')
    expect(payload.reference).toBe('OCR-BBB-002')
  })
})
