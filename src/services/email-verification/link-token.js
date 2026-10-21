import { createHash, randomBytes } from 'node:crypto'

// The secret in a magic link: 32 bytes (256 bits) from the OS random source,
// base64url-encoded to 43 characters with no padding. At that size the token
// can't be guessed, so its plain sha256 is safe to store and look up by: no
// salt or secret is needed, and a database leak exposes no usable link.
const TOKEN_BYTES = 32
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function hashLinkToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

// The raw token goes only into the email; only tokenHash is stored.
export function generateLinkToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashLinkToken(token) }
}

// Lets verify reject a malformed token without querying the database.
export function isLinkTokenFormat(token) {
  return typeof token === 'string' && LINK_TOKEN_PATTERN.test(token)
}
