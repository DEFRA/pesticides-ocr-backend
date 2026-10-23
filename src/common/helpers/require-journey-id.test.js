import { createHmac } from 'node:crypto'
import { describe, test, expect, afterEach } from 'vitest'

import { config } from '#/config.js'
import {
  optionalJourneyId,
  requireJourneyId
} from '#/common/helpers/require-journey-id.js'

const SECRET = 'journey-test-secret'
const NONCE = '3f2b8c1e-7a4d-4e9b-9c6f-1d2e3f4a5b6c'
const sign = (nonce, secret = SECRET) =>
  `${nonce}.${createHmac('sha256', secret).update(nonce).digest('hex')}`
const requestWith = (token) => ({
  headers: token === undefined ? {} : { 'x-journey-token': token }
})

const originalSecret = config.get('journeyToken.secret')

afterEach(() => {
  config.set('journeyToken.secret', originalSecret)
})

describe('#requireJourneyId', () => {
  test('returns the nonce from a validly signed token', () => {
    config.set('journeyToken.secret', SECRET)

    expect(requireJourneyId(requestWith(sign(NONCE)))).toBe(NONCE)
  })

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['unsigned', NONCE],
    ['signed with another secret', sign(NONCE, 'another-secret')],
    ['tampered', sign(NONCE).replace(NONCE, 'another-nonce')],
    ['an array of headers', [sign(NONCE)]]
  ])(
    'throws 401 JOURNEY_TOKEN_INVALID when the token is %s',
    (_label, token) => {
      config.set('journeyToken.secret', SECRET)

      expect(() => requireJourneyId(requestWith(token))).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({
            statusCode: 401,
            payload: expect.objectContaining({ code: 'JOURNEY_TOKEN_INVALID' })
          })
        })
      )
    }
  )

  test('throws 503 SERVICE_NOT_CONFIGURED when the secret is unset, even for a signed token', () => {
    config.set('journeyToken.secret', '')

    expect(() => requireJourneyId(requestWith(sign(NONCE)))).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 503,
          payload: expect.objectContaining({ code: 'SERVICE_NOT_CONFIGURED' })
        })
      })
    )
  })
})

describe('#optionalJourneyId', () => {
  test('returns the nonce from a validly signed token', () => {
    config.set('journeyToken.secret', SECRET)

    expect(optionalJourneyId(requestWith(sign(NONCE)))).toBe(NONCE)
  })

  test.each([
    ['missing', undefined],
    ['unsigned', NONCE],
    ['signed with another secret', sign(NONCE, 'another-secret')]
  ])('returns null when the token is %s', (_label, token) => {
    config.set('journeyToken.secret', SECRET)

    expect(optionalJourneyId(requestWith(token))).toBeNull()
  })

  test('returns null, rather than refusing, when the secret is unset', () => {
    config.set('journeyToken.secret', '')

    expect(optionalJourneyId(requestWith(sign(NONCE)))).toBeNull()
  })
})
