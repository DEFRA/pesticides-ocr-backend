import { describe, test, expect } from 'vitest'
import { createHmac } from 'node:crypto'

import { verifiedNonce } from './journey-token.js'

const SECRET = 'shared-test-secret'
const sign = (nonce) =>
  `${nonce}.${createHmac('sha256', SECRET).update(nonce).digest('hex')}`

describe('#verifiedNonce', () => {
  test('returns the nonce for a validly signed token', () => {
    expect(verifiedNonce(sign('session-abc'), SECRET)).toBe('session-abc')
  })

  test('null for a tampered signature', () => {
    expect(verifiedNonce('session-abc.deadbeef', SECRET)).toBeNull()
  })

  test('null when signed with a different secret', () => {
    const forged = `session-abc.${createHmac('sha256', 'other')
      .update('session-abc')
      .digest('hex')}`
    expect(verifiedNonce(forged, SECRET)).toBeNull()
  })

  test('null for missing / malformed tokens', () => {
    expect(verifiedNonce('', SECRET)).toBeNull()
    expect(verifiedNonce(undefined, SECRET)).toBeNull()
    expect(verifiedNonce('no-separator', SECRET)).toBeNull()
    expect(verifiedNonce('.signature-only', SECRET)).toBeNull()
    expect(verifiedNonce('nonce-only.', SECRET)).toBeNull()
  })

  test('null when no secret is configured', () => {
    expect(verifiedNonce(sign('session-abc'), '')).toBeNull()
  })
})
