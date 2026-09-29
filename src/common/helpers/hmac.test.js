import { describe, test, expect } from 'vitest'
import { randomHex, hmacHex, hmacHexEquals } from './hmac.js'

describe('randomHex', () => {
  test('returns a hex string of the requested byte length', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/)
  })

  test('returns a different value on each call', () => {
    expect(randomHex(16)).not.toBe(randomHex(16))
  })
})

describe('hmacHex', () => {
  test('is deterministic for the same secret and value', () => {
    expect(hmacHex('secret', 'value')).toBe(hmacHex('secret', 'value'))
  })

  test('differs when the value changes', () => {
    expect(hmacHex('secret', 'value-a')).not.toBe(hmacHex('secret', 'value-b'))
  })

  test('differs when the secret changes', () => {
    expect(hmacHex('secret-a', 'value')).not.toBe(hmacHex('secret-b', 'value'))
  })

  test('throws when no secret is provided', () => {
    expect(() => hmacHex('', 'value')).toThrow('No HMAC secret configured')
  })
})

describe('hmacHexEquals', () => {
  test('returns true when the value hashes to the expected digest', () => {
    const expected = hmacHex('secret', 'value')
    expect(hmacHexEquals('secret', 'value', expected)).toBe(true)
  })

  test('returns false when the value is wrong', () => {
    const expected = hmacHex('secret', 'value')
    expect(hmacHexEquals('secret', 'wrong-value', expected)).toBe(false)
  })

  test('returns false rather than throwing when digest lengths differ', () => {
    expect(hmacHexEquals('secret', 'value', 'ab')).toBe(false)
  })
})
