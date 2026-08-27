import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import Hapi from '@hapi/hapi'
import { SignJWT } from 'jose'

import { auth } from '#/auth/auth.js'
import { whoami } from '#/routes/whoami.js'

// Mint a JWT for mock mode. The signature is irrelevant here — mock mode decodes
// the token without verifying it — so any key works; only the claims matter.
function mockToken({ sub = 'officer-1', name = 'Case Officer', roles } = {}) {
  const payload = { name }
  if (roles !== undefined) {
    payload.roles = roles
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .sign(new TextEncoder().encode('mock-signing-secret-not-verified'))
}

// Exercises the real /whoami route object + its requireRole auth against a
// minimal server (the app default auth mode is mock), without pulling in the
// mongo plugin from createServer.
describe('GET /whoami (protected, mock mode)', () => {
  let server

  beforeAll(async () => {
    server = Hapi.server()
    await server.register(auth)
    server.route(whoami)
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('401 when no bearer token is presented', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/whoami'
    })
    expect(statusCode).toBe(401)
  })

  test('403 when the token lacks the case_officer role', async () => {
    const token = await mockToken({ roles: ['viewer'] })
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(statusCode).toBe(403)
  })

  test('200 with the caller identity when the token carries case_officer', async () => {
    const token = await mockToken({
      sub: 'officer-1',
      name: 'Case Officer',
      roles: ['case_officer']
    })
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(statusCode).toBe(200)
    expect(result).toEqual({
      subject: 'officer-1',
      name: 'Case Officer',
      roles: ['case_officer']
    })
  })
})
