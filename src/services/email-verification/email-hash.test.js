import { createHmac } from 'node:crypto'
import { describe, test, expect } from 'vitest'

import { hashEmail } from '#/services/email-verification/email-hash.js'

describe('#hashEmail', () => {
  test('is the HMAC-SHA256 hex of the address under the secret', () => {
    expect(hashEmail('jane@example.com', 'secret')).toBe(
      createHmac('sha256', 'secret').update('jane@example.com').digest('hex')
    )
  })

  test('differs by secret, so a known address cannot be looked up without it', () => {
    expect(hashEmail('jane@example.com', 'one')).not.toBe(
      hashEmail('jane@example.com', 'two')
    )
  })

  test('does not contain the address', () => {
    expect(hashEmail('jane@example.com', 'secret')).not.toContain('jane')
  })
})
