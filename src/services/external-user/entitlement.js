import { normaliseEmail } from '#/services/email-verification/email-address.js'

// Decision (completion ticket, "which verified contact or ownership
// relationship establishes registration entitlement"): the verified email
// must match the registration's own primary contact email, normalised the
// same way as every other comparison in this service (trim + lower-case).
// This is deliberately the ONLY relationship checked — additionalAddresses'
// contacts are a different concern (not modelled as separate login-capable
// identities) and are out of scope here.
//
// Returns true/false only — never throws for "not entitled", and never
// exposes whether the registration exists to a caller who isn't entitled to
// it (AC1: no data disclosure on a failed entitlement check).
export function isEntitledToRegistration(registration, email) {
  if (!registration) {
    return false
  }
  const contactEmail = registration?.primaryContact?.contactEmail
  if (!contactEmail) {
    return false
  }
  return normaliseEmail(contactEmail) === normaliseEmail(email)
}
