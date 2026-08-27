import { describe, test, expect, vi, afterEach } from 'vitest'
import Hapi from '@hapi/hapi'

import { config } from '#/config.js'
import { auth, resolveEntra } from './auth.js'

function stubConfig(values) {
  vi.spyOn(config, 'get').mockImplementation((key) => values[key])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveEntra', () => {
  test('derives the v2.0 issuer and JWKS URI from tenantId when not set', () => {
    stubConfig({
      'auth.entra': { tenantId: 't1', audience: 'aud', issuer: '', jwksUri: '' }
    })
    const resolved = resolveEntra()
    expect(resolved.issuer).toBe('https://login.microsoftonline.com/t1/v2.0')
    expect(resolved.jwksUri).toBe(
      'https://login.microsoftonline.com/t1/discovery/v2.0/keys'
    )
    expect(resolved.audience).toBe('aud')
  })

  test('uses explicit issuer/jwksUri when provided', () => {
    stubConfig({
      'auth.entra': {
        tenantId: 't1',
        audience: 'aud',
        issuer: 'https://issuer.example',
        jwksUri: 'https://jwks.example'
      }
    })
    const resolved = resolveEntra()
    expect(resolved.issuer).toBe('https://issuer.example')
    expect(resolved.jwksUri).toBe('https://jwks.example')
  })
})

describe('auth plugin register guards (fail closed)', () => {
  async function register(values) {
    stubConfig(values)
    const server = Hapi.server()
    await server.register(auth)
    return server
  }

  test.each(['prod', 'dev', 'test', 'perf-test', 'ext-test', 'infra-dev'])(
    'throws when mock mode is used on the deployed %s tier',
    async (cdpEnvironment) => {
      await expect(
        register({ 'auth.mode': 'mock', cdpEnvironment })
      ).rejects.toThrow(/mock mode is only allowed locally/)
    }
  )

  test('warns (does NOT crash) when live mode is missing tenantId/audience', async () => {
    // Unprotected routes must still deploy while Entra onboarding is pending;
    // the scheme fails closed per request instead.
    stubConfig({
      'auth.mode': 'live',
      cdpEnvironment: 'dev',
      'auth.entra': { tenantId: '', audience: '', issuer: '', jwksUri: '' }
    })
    const server = Hapi.server()
    const logs = []
    server.events.on('log', (event) => logs.push(event))
    await server.register(auth)
    const warning = logs.find(
      (event) => event.tags.includes('auth') && event.tags.includes('warn')
    )
    expect(warning).toBeDefined()
    expect(warning.data).toContain('not fully configured')
  })

  test('registers the entra-bearer strategy in mock mode locally', async () => {
    const server = await register({
      'auth.mode': 'mock',
      cdpEnvironment: 'local'
    })
    expect(() =>
      server.route({
        method: 'GET',
        path: '/x',
        options: { auth: 'entra-bearer' },
        handler: () => 'ok'
      })
    ).not.toThrow()
  })
})
