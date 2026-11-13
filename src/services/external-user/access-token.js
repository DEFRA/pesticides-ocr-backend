import { SignJWT, jwtVerify } from 'jose'

import { config } from '#/config.js'

// External-user access tokens (EQ external-RBAC): a short-lived, HMAC-signed
// JWT issued after a verified applicant has been granted access to a specific
// registration (see routes/email-verification/email-verifications.js). It is
// the authorisation credential external-bearer validates — distinct from the
// one-time magic-link token and the journey-tracking token.
//
// Deliberately separate signing material and claim shape from the Entra
// (internal) tokens: this is NOT a delegated-scope OAuth access token, it is
// a service-issued, single-registration-scoped credential with its own
// issuer/audience, so the two token families can never be confused by
// external-bearer / entra-bearer (AC2 of the completion ticket).
const ALG = 'HS256'
const ISSUER = 'pesticides-ocr-backend'
const AUDIENCE = 'pesticides-ocr-external-user'

function requireSecret() {
  const secret = config.get('externalUser.tokenSecret')
  if (!secret) {
    throw new Error(
      'externalUser.tokenSecret is not configured — cannot issue or verify external-user access tokens'
    )
  }
  return new TextEncoder().encode(secret)
}

// Issues a token scoped to exactly one subject/registration pair. `roles`
// always carries only the external-user role — never any internal role value
// (AC2/AC6: this token can never grant hse_user/dg_user/case_officer scope).
export async function issueExternalAccessToken({ subject, reference }) {
  const key = requireSecret()
  const ttlSeconds = config.get('externalUser.tokenTtlSeconds')
  const role = config.get('externalUser.role')

  return new SignJWT({ reference, roles: [role] })
    .setProtectedHeader({ alg: ALG })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key)
}

// Verifies signature, issuer, audience, algorithm and expiry. Throws on any
// mismatch — callers (external-bearer-scheme) must treat any rejection as an
// opaque 401, never branching on the specific reason (no probing signal).
export async function verifyExternalAccessToken(token) {
  const key = requireSecret()
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALG]
  })
  return payload
}
