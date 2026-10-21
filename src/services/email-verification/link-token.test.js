import { createHash } from 'node:crypto'
import { describe, test, expect } from 'vitest'

import {
  generateLinkToken,
  hashLinkToken,
  isLinkTokenFormat
} from '#/services/email-verification/link-token.js'

describe('#generateLinkToken', () => {
  test('returns a 43-character base64url token encoding 32 bytes', () => {
    const { token } = generateLinkToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  test('returns the sha256 hex of the token as its hash', () => {
    const { token, tokenHash } = generateLinkToken()

    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).not.toContain(token)
  })

  test('returns a different token every time', () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => generateLinkToken().token)
    )

    expect(tokens.size).toBe(1000)
  })
})

describe('#hashLinkToken', () => {
  test('gives the same hash for the same token', () => {
    const { token, tokenHash } = generateLinkToken()

    expect(hashLinkToken(token)).toBe(tokenHash)
  })

  test('gives a different hash for a different token', () => {
    expect(hashLinkToken('a'.repeat(43))).not.toBe(
      hashLinkToken('b'.repeat(43))
    )
  })
})

describe('#isLinkTokenFormat', () => {
  test('accepts a generated token', () => {
    expect(isLinkTokenFormat(generateLinkToken().token)).toBe(true)
  })

  test.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['empty', ''],
    ['padded', `${'a'.repeat(42)}=`],
    ['standard base64 +', `${'a'.repeat(42)}+`],
    ['standard base64 /', `${'a'.repeat(42)}/`],
    ['a trailing newline', `${'a'.repeat(43)}\n`],
    ['whitespace', ` ${'a'.repeat(42)}`]
  ])('rejects a token that is %s', (_label, token) => {
    expect(isLinkTokenFormat(token)).toBe(false)
  })

  test.each([undefined, null, 42, { $ne: '' }, ['a'.repeat(43)]])(
    'rejects a non-string token (%o)',
    (token) => {
      expect(isLinkTokenFormat(token)).toBe(false)
    }
  )
})
