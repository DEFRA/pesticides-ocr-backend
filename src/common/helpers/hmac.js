import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomHex(bytes) {
  return randomBytes(bytes).toString('hex')
}

export function hmacHex(secret, value) {
  if (!secret) {
    throw new Error('No HMAC secret configured')
  }
  return createHmac('sha256', secret).update(value).digest('hex')
}

// Constant-time comparison of two hex digests of the same expected length,
// so response timing can't be used to recover a code/token one bit at a time.
export function hmacHexEquals(secret, value, expectedHex) {
  const actual = Buffer.from(hmacHex(secret, value), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
