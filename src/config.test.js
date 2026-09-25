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

// A misconfigured value must stop the app at startup (config.validate strict),
// not surface later as a broken endpoint.
describe('config startup validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadConfigWith(name, value) {
    vi.resetModules()
    vi.stubEnv(name, value)
    return import('#/config.js')
  }

  test('reads EXPORT_MAX_ROWS from the environment as a number', async () => {
    const { config } = await loadConfigWith('EXPORT_MAX_ROWS', '250')
    expect(config.get('export.maxRows')).toBe(250)
  })

  test.each(['0', '-1', 'abc', '10abc', '1.5'])(
    'refuses to start with EXPORT_MAX_ROWS=%s',
    async (value) => {
      await expect(loadConfigWith('EXPORT_MAX_ROWS', value)).rejects.toThrow(
        /export\.maxRows/
      )
    }
  )

  test.each(['ppp', 'P-P'])(
    'refuses to start with REFERENCE_PREFIX=%s',
    async (value) => {
      await expect(loadConfigWith('REFERENCE_PREFIX', value)).rejects.toThrow(
        /referencePrefix/
      )
    }
  )
})
