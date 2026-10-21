import { describe, test, expect } from 'vitest'

import { validateEmailVerificationConfig } from '#/common/helpers/convict/validate-email-verification.js'

const configWith = ({ cdpEnvironment = 'dev', ...settings } = {}) => {
  const values = {
    cdpEnvironment,
    emailVerification: {
      linkTtlSeconds: 900,
      verifiedTtlSeconds: 14400,
      recordRetentionSeconds: 86400,
      linkBaseUrl: '',
      ...settings
    }
  }
  return { get: (key) => values[key] }
}

describe('#validateEmailVerificationConfig', () => {
  test('accepts the defaults', () => {
    expect(() => validateEmailVerificationConfig(configWith())).not.toThrow()
  })

  test.each(['https://ocr.example.gov.uk', 'https://localhost:8443'])(
    'accepts the https origin %s on a deployed tier',
    (linkBaseUrl) => {
      expect(() =>
        validateEmailVerificationConfig(configWith({ linkBaseUrl }))
      ).not.toThrow()
    }
  )

  test.each([
    ['http on a deployed tier', 'http://ocr.example.gov.uk', /https/],
    ['another scheme', 'ftp://ocr.example.gov.uk', /https/],
    ['no scheme', 'ocr.example.gov.uk', /must be a URL/],
    ['a trailing slash', 'https://ocr.example.gov.uk/', /origin/],
    ['a path', 'https://ocr.example.gov.uk/register', /origin/],
    ['a query', 'https://ocr.example.gov.uk?x=1', /origin/],
    ['credentials', 'https://user:pass@ocr.example.gov.uk', /origin/]
  ])('refuses a link base URL with %s', (_label, linkBaseUrl, message) => {
    expect(() =>
      validateEmailVerificationConfig(configWith({ linkBaseUrl }))
    ).toThrow(message)
  })

  test('accepts http on the local tier', () => {
    expect(() =>
      validateEmailVerificationConfig(
        configWith({
          cdpEnvironment: 'local',
          linkBaseUrl: 'http://localhost:3000'
        })
      )
    ).not.toThrow()
  })

  test('accepts a retention exactly as long as the link and verified TTLs', () => {
    expect(() =>
      validateEmailVerificationConfig(
        configWith({ recordRetentionSeconds: 15300 })
      )
    ).not.toThrow()
  })

  test('refuses a retention shorter than the link and verified TTLs', () => {
    expect(() =>
      validateEmailVerificationConfig(
        configWith({ recordRetentionSeconds: 15299 })
      )
    ).toThrow(/at least linkTtlSeconds \+ verifiedTtlSeconds \(15300\)/)
  })
})
