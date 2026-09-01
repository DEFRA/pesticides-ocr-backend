import { describe, test, expect, vi, afterEach } from 'vitest'

// The auth mode default must key off the CDP environment tier, so a deployed
// tier can never silently fall back to the unverified mock path.
describe('config auth.mode default per environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadConfigFor(environment) {
    vi.resetModules()
    vi.stubEnv('ENVIRONMENT', environment)
    vi.stubEnv('AUTH_MODE', undefined) // unset so the default (not an override) is exercised
    const { config } = await import('#/config.js')
    return config
  }

  test('defaults to mock on the local tier', async () => {
    const config = await loadConfigFor('local')
    expect(config.get('auth.mode')).toBe('mock')
  })

  test.each(['infra-dev', 'dev', 'test', 'perf-test', 'ext-test', 'prod'])(
    'defaults to live on the deployed %s tier',
    async (environment) => {
      const config = await loadConfigFor(environment)
      expect(config.get('auth.mode')).toBe('live')
    }
  )
})
