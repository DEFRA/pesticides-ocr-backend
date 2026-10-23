import { describe, test, expect, vi, afterEach } from 'vitest'
import { pino } from 'pino'

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

  test('reads SEARCH_MAX_PAGE_SIZE from the environment as a number', async () => {
    const { config } = await loadConfigWith('SEARCH_MAX_PAGE_SIZE', '50')
    expect(config.get('search.maxPageSize')).toBe(50)
  })

  test.each(['0', '-1', 'abc', '1.5'])(
    'refuses to start with SEARCH_MAX_PAGE_SIZE=%s',
    async (value) => {
      await expect(
        loadConfigWith('SEARCH_MAX_PAGE_SIZE', value)
      ).rejects.toThrow(/search\.maxPageSize/)
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

describe('config email verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadConfigWith(env) {
    vi.resetModules()
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value)
    }
    return import('#/config.js')
  }

  test('defaults the link to 15 minutes and leaves secrets, URL and template empty', async () => {
    const { config } = await loadConfigWith({})

    expect(config.get('emailVerification')).toEqual({
      linkTtlSeconds: 900,
      verifiedTtlSeconds: 14400,
      recordRetentionSeconds: 86400,
      resendCooldownSeconds: 60,
      maxSendsPerEmailPerHour: 5,
      maxSendsPerJourneyPerHour: 5,
      maxSendsGlobalPerHour: 1000,
      linkBaseUrl: '',
      hashSecret: '',
      requiredForRegistration: false
    })
    expect(config.get('notify.templates.emailVerificationLink')).toBe('')
  })

  test('lets a tier turn on the /register verification gate', async () => {
    const { config } = await loadConfigWith({
      EMAIL_VERIFICATION_REQUIRED_FOR_REGISTRATION: 'true'
    })

    expect(config.get('emailVerification.requiredForRegistration')).toBe(true)
  })

  test('keeps the hash secret out of the printed config', async () => {
    const { config } = await loadConfigWith({
      EMAIL_VERIFICATION_HASH_SECRET: 'do-not-print-me'
    })

    expect(config.toString()).not.toContain('do-not-print-me')
  })

  test.each([
    ['EMAIL_VERIFICATION_LINK_TTL_SECONDS', 'linkTtlSeconds'],
    ['EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS', 'verifiedTtlSeconds'],
    ['EMAIL_VERIFICATION_RECORD_RETENTION_SECONDS', 'recordRetentionSeconds'],
    ['EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS', 'resendCooldownSeconds'],
    [
      'EMAIL_VERIFICATION_MAX_SENDS_PER_EMAIL_PER_HOUR',
      'maxSendsPerEmailPerHour'
    ],
    [
      'EMAIL_VERIFICATION_MAX_SENDS_PER_JOURNEY_PER_HOUR',
      'maxSendsPerJourneyPerHour'
    ],
    ['EMAIL_VERIFICATION_MAX_SENDS_GLOBAL_PER_HOUR', 'maxSendsGlobalPerHour']
  ])('refuses to start with %s=0', async (name, key) => {
    await expect(loadConfigWith({ [name]: '0' })).rejects.toThrow(
      new RegExp(`emailVerification\\.${key}`)
    )
  })

  test('accepts an https link base URL on a deployed tier', async () => {
    const { config } = await loadConfigWith({
      ENVIRONMENT: 'dev',
      EMAIL_VERIFICATION_LINK_BASE_URL: 'https://ocr.example.gov.uk'
    })

    expect(config.get('emailVerification.linkBaseUrl')).toBe(
      'https://ocr.example.gov.uk'
    )
  })

  test('refuses an http link base URL on a deployed tier', async () => {
    await expect(
      loadConfigWith({
        ENVIRONMENT: 'dev',
        EMAIL_VERIFICATION_LINK_BASE_URL: 'http://ocr.example.gov.uk'
      })
    ).rejects.toThrow(/emailVerification\.linkBaseUrl: must use https/)
  })

  test('accepts an http link base URL on the local tier', async () => {
    const { config } = await loadConfigWith({
      ENVIRONMENT: 'local',
      EMAIL_VERIFICATION_LINK_BASE_URL: 'http://localhost:3000'
    })

    expect(config.get('emailVerification.linkBaseUrl')).toBe(
      'http://localhost:3000'
    )
  })

  test('refuses to start when the retention is shorter than the link and verified TTLs', async () => {
    await expect(
      loadConfigWith({
        EMAIL_VERIFICATION_LINK_TTL_SECONDS: '900',
        EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS: '14400',
        EMAIL_VERIFICATION_RECORD_RETENTION_SECONDS: '15299'
      })
    ).rejects.toThrow(/emailVerification\.recordRetentionSeconds/)
  })
})

describe('config log.redact in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function productionRedactPaths() {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    const { config } = await import('#/config.js')
    return config.get('log.redact')
  }

  test('redacts the journey token header with the other credentials', async () => {
    expect(await productionRedactPaths()).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-journey-token"]',
      'res.headers'
    ])
  })

  test('removes the journey token header from a request log line', async () => {
    const lines = []
    const logger = pino(
      { redact: { paths: await productionRedactPaths(), remove: true } },
      { write: (line) => lines.push(JSON.parse(line)) }
    )

    logger.info({
      req: {
        url: '/email-verifications',
        headers: { 'x-journey-token': 'nonce.signature', accept: '*/*' }
      }
    })

    expect(lines[0].req.headers).toEqual({ accept: '*/*' })
  })
})
