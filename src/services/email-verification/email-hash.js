import { createHmac } from 'node:crypto'

// A keyed hash of a normalised email address, for rate-limit keys (and audit
// records) that must tell addresses apart without storing them. Keyed, unlike
// the link token hash, because email addresses are guessable.
export function hashEmail(email, secret) {
  return createHmac('sha256', secret).update(email).digest('hex')
}
