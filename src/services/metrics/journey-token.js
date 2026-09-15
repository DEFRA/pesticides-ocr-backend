// Verifies the signed per-session token the frontend sends with journey-tracking
// beacons (EQ-472). The token is `<nonce>.<hmac>` where hmac = HMAC-SHA256 of the
// nonce under a secret shared (via CDP Secrets) with the frontend. A valid
// signature proves the beacon genuinely came from our journey — not a script
// hitting the public endpoint directly — and the nonce lets the caller record
// each session's event once (unique index) so replays can't inflate the count.
//
// WIRE-FORMAT CONTRACT: this must match the signer in pesticides-ocr-frontend
// src/server/common/helpers/journey-beacon.js (same `<nonce>.<hmac>` shape,
// sha256, hex digest, shared JOURNEY_TOKEN_SECRET). Keep the two in sync.

import { createHmac, timingSafeEqual } from 'node:crypto'

// Return the nonce if the token's signature verifies under `secret`, else null.
// Never throws on malformed input — a bad token is simply "not verified".
export function verifiedNonce(token, secret) {
  if (typeof token !== 'string' || !secret) {
    return null
  }

  const separator = token.lastIndexOf('.')
  if (separator <= 0) {
    return null
  }

  const nonce = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!signature) {
    return null
  }

  const expected = createHmac('sha256', secret).update(nonce).digest('hex')
  // Decode both hex strings to raw bytes for a byte-for-byte constant-time
  // compare. A non-hex signature decodes to a different length and is rejected by
  // the length check (timingSafeEqual throws on mismatched lengths).
  const given = Buffer.from(signature, 'hex')
  const want = Buffer.from(expected, 'hex')

  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null
  }

  return nonce
}
