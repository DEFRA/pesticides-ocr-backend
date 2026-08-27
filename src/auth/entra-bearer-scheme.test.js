import { describe, test, expect, beforeAll } from 'vitest'
import Hapi from '@hapi/hapi'
import { SignJWT, generateKeyPair } from 'jose'

import { entraBearerScheme } from './entra-bearer-scheme.js'
import { requireRole } from './require-role.js'
import { STRATEGY_NAME } from './strategy-name.js'

const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0'
const AUDIENCE = 'api://ocr-backend'

// A Hapi server wired with the scheme under test and a single protected route.
// getKeySet is injected so the live path verifies against a local key pair
// instead of fetching a remote JWKS.
async function buildServer({ mode, getKeySet, resolveEntra }) {
  const server = Hapi.server()
  server.auth.scheme(STRATEGY_NAME, (s, options) =>
    entraBearerScheme(s, {
      mode,
      getKeySet,
      resolveEntra:
        resolveEntra ??
        (() => ({
          issuer: ISSUER,
          audience: AUDIENCE,
          jwksUri: 'x'
        })),
      ...options
    })
  )
  server.auth.strategy(STRATEGY_NAME, STRATEGY_NAME)
  server.route({
    method: 'GET',
    path: '/protected',
    options: { auth: requireRole('case_officer') },
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

describe('entraBearerScheme — live mode (signature + claim verification)', () => {
  let server
  let signingKey

  // A token signed by a DIFFERENT key than the server trusts, for the
  // tampered/invalid-signature case.
  let otherKey

  beforeAll(async () => {
    const trusted = await generateKeyPair('RS256')
    signingKey = trusted.privateKey
    otherKey = (await generateKeyPair('RS256')).privateKey
    server = await buildServer({
      mode: 'live',
      getKeySet: () => trusted.publicKey
    })
  })

  function sign(
    privateKey,
    claims,
    { iss = ISSUER, aud = AUDIENCE, exp = '5m' } = {}
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('officer-1')
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey)
  }

  test('200 for a valid, correctly-signed token with the required role', async () => {
    const token = await sign(signingKey, {
      name: 'Case Officer',
      roles: ['case_officer']
    })
    const { statusCode, result } = await get(server, token)
    expect(statusCode).toBe(200)
    expect(result.subject).toBe('officer-1')
    expect(result.roles).toEqual(['case_officer'])
  })

  test('403 for a valid token whose roles do not include case_officer', async () => {
    const token = await sign(signingKey, { roles: ['viewer'] })
    expect((await get(server, token)).statusCode).toBe(403)
  })

  test('401 when the signature does not match the trusted key', async () => {
    const token = await sign(otherKey, { roles: ['case_officer'] })
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('does not leak the failure reason in the 401 body', async () => {
    const token = await sign(otherKey, { roles: ['case_officer'] })
    const { result } = await get(server, token)
    expect(result.message).toBe('Invalid bearer token')
  })

  test('401 (fails closed) when live mode is not configured (missing audience)', async () => {
    const unconfigured = await buildServer({
      mode: 'live',
      getKeySet: () => null,
      resolveEntra: () => ({ issuer: ISSUER, audience: '', jwksUri: 'x' })
    })
    const token = await sign(signingKey, { roles: ['case_officer'] })
    expect((await get(unconfigured, token)).statusCode).toBe(401)
  })

  test('401 for a wrong audience', async () => {
    const token = await sign(
      signingKey,
      { roles: ['case_officer'] },
      { aud: 'api://someone-else' }
    )
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('401 for a wrong issuer', async () => {
    const token = await sign(
      signingKey,
      { roles: ['case_officer'] },
      { iss: 'https://evil.example/v2.0' }
    )
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('401 for an expired token', async () => {
    const token = await sign(
      signingKey,
      { roles: ['case_officer'] },
      { exp: '-1m' }
    )
    expect((await get(server, token)).statusCode).toBe(401)
  })

  test('401 when no bearer token is presented', async () => {
    expect((await get(server)).statusCode).toBe(401)
  })

  test('401 for a non-bearer Authorization header', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' }
    })
    expect(statusCode).toBe(401)
  })
})

describe('entraBearerScheme — mock mode (decode without verification)', () => {
  let server

  beforeAll(async () => {
    server = await buildServer({ mode: 'mock' })
  })

  function mockToken(claims) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('officer-1')
      .sign(new TextEncoder().encode('irrelevant-mock-secret'))
  }

  test('200 for any decodable token carrying the required role', async () => {
    const token = await mockToken({
      name: 'Mock Officer',
      roles: ['case_officer']
    })
    const { statusCode, result } = await get(server, token)
    expect(statusCode).toBe(200)
    expect(result.name).toBe('Mock Officer')
  })

  test('403 when the decoded token lacks the required role', async () => {
    const token = await mockToken({ roles: [] })
    expect((await get(server, token)).statusCode).toBe(403)
  })

  test('401 for a malformed token', async () => {
    expect((await get(server, 'not-a-jwt')).statusCode).toBe(401)
  })
})
