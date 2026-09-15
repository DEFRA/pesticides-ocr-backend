import { describe, test, expect, vi, afterEach } from 'vitest'

import { config } from '#/config.js'
import { warnIfJourneyTokenUnset } from '#/routes/metrics/metrics.js'

const originalEnv = config.get('cdpEnvironment')
const originalSecret = config.get('journeyToken.secret')

afterEach(() => {
  config.set('cdpEnvironment', originalEnv)
  config.set('journeyToken.secret', originalSecret)
})

describe('#warnIfJourneyTokenUnset', () => {
  test('warns on a deployed tier when the secret is unset (fail-open signal)', () => {
    config.set('cdpEnvironment', 'dev')
    config.set('journeyToken.secret', '')
    const server = { log: vi.fn() }

    warnIfJourneyTokenUnset(server)

    expect(server.log).toHaveBeenCalledWith(
      ['metrics', 'warn'],
      expect.stringContaining('not configured')
    )
  })

  test('stays silent on the local tier', () => {
    config.set('cdpEnvironment', 'local')
    config.set('journeyToken.secret', '')
    const server = { log: vi.fn() }

    warnIfJourneyTokenUnset(server)

    expect(server.log).not.toHaveBeenCalled()
  })

  test('stays silent when the secret is set on a deployed tier', () => {
    config.set('cdpEnvironment', 'dev')
    config.set('journeyToken.secret', 'a-secret')
    const server = { log: vi.fn() }

    warnIfJourneyTokenUnset(server)

    expect(server.log).not.toHaveBeenCalled()
  })
})
