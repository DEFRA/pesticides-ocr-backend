import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { config } from '#/config.js'
import {
  missingEmailVerificationSettings,
  warnIfEmailVerificationUnconfigured,
  warnIfRegistrationGateDisabled
} from '#/services/email-verification/config-guard.js'

const KEYS = [
  'cdpEnvironment',
  'journeyToken.secret',
  'emailVerification.hashSecret',
  'emailVerification.linkBaseUrl',
  'notify.apiKey',
  'notify.templates.emailVerificationLink',
  'emailVerification.requiredForRegistration'
]
const original = Object.fromEntries(KEYS.map((key) => [key, config.get(key)]))

beforeEach(() => {
  config.set('cdpEnvironment', 'dev')
  config.set('journeyToken.secret', 'journey-secret')
  config.set('emailVerification.hashSecret', 'hash-secret')
  config.set('emailVerification.linkBaseUrl', 'https://ocr.example.gov.uk')
  config.set('notify.apiKey', 'notify-key')
  config.set('notify.templates.emailVerificationLink', 'template-id')
  config.set('emailVerification.requiredForRegistration', true)
})

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    config.set(key, value)
  }
})

describe('#missingEmailVerificationSettings', () => {
  test('is empty when everything is configured', () => {
    expect(missingEmailVerificationSettings()).toEqual([])
  })

  test.each([
    ['journeyToken.secret', 'JOURNEY_TOKEN_SECRET'],
    ['emailVerification.hashSecret', 'EMAIL_VERIFICATION_HASH_SECRET'],
    ['emailVerification.linkBaseUrl', 'EMAIL_VERIFICATION_LINK_BASE_URL'],
    ['notify.apiKey', 'NOTIFY_API_KEY'],
    [
      'notify.templates.emailVerificationLink',
      'NOTIFY_TEMPLATE_EMAIL_VERIFICATION_LINK'
    ]
  ])('names %s when it is empty', (key, envName) => {
    config.set(key, '')

    expect(missingEmailVerificationSettings()).toEqual([envName])
  })
})

describe('#warnIfEmailVerificationUnconfigured', () => {
  test('warns once per missing setting on a deployed tier, by name only', () => {
    config.set('emailVerification.hashSecret', '')
    config.set('notify.templates.emailVerificationLink', '')
    const server = { log: vi.fn() }

    warnIfEmailVerificationUnconfigured(server)

    expect(server.log).toHaveBeenCalledTimes(2)
    expect(server.log).toHaveBeenCalledWith(
      ['email-verification', 'warn'],
      expect.stringContaining('EMAIL_VERIFICATION_HASH_SECRET')
    )
    expect(server.log).toHaveBeenCalledWith(
      ['email-verification', 'warn'],
      expect.stringContaining('NOTIFY_TEMPLATE_EMAIL_VERIFICATION_LINK')
    )
    expect(JSON.stringify(server.log.mock.calls)).not.toContain(
      'journey-secret'
    )
  })

  test('stays silent when everything is configured', () => {
    const server = { log: vi.fn() }

    warnIfEmailVerificationUnconfigured(server)

    expect(server.log).not.toHaveBeenCalled()
  })

  test('stays silent on the local tier', () => {
    config.set('cdpEnvironment', 'local')
    config.set('emailVerification.hashSecret', '')
    const server = { log: vi.fn() }

    warnIfEmailVerificationUnconfigured(server)

    expect(server.log).not.toHaveBeenCalled()
  })
})

describe('#warnIfRegistrationGateDisabled', () => {
  test('warns on a deployed tier when /register skips verification', () => {
    config.set('emailVerification.requiredForRegistration', false)
    const server = { log: vi.fn() }

    warnIfRegistrationGateDisabled(server)

    expect(server.log).toHaveBeenCalledExactlyOnceWith(
      ['email-verification', 'warn'],
      expect.stringContaining('EMAIL_VERIFICATION_REQUIRED_FOR_REGISTRATION')
    )
  })

  test('stays silent when the gate is on', () => {
    const server = { log: vi.fn() }

    warnIfRegistrationGateDisabled(server)

    expect(server.log).not.toHaveBeenCalled()
  })

  test('stays silent on the local tier', () => {
    config.set('cdpEnvironment', 'local')
    config.set('emailVerification.requiredForRegistration', false)
    const server = { log: vi.fn() }

    warnIfRegistrationGateDisabled(server)

    expect(server.log).not.toHaveBeenCalled()
  })
})
