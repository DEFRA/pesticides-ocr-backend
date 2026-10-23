// MongoDB collection names — single source of truth, so the collection name is
// not duplicated as a magic string across services and plugins.

export const OCR_REGISTRATION_COLLECTION = 'ocr-registration'
export const OCR_REGISTRATION_HISTORY_COLLECTION = 'ocr-registration_history'
export const AUDIT_HISTORY_COLLECTION = 'audit_history'
export const MONGO_LOCKS_COLLECTION = 'mongo-locks'

// Journey events recorded server-side, once per session, as the applicant moves
// through the journey — a consent-free basis for the completion rate (EQ-472).
// No PII: just a timestamp. Completions come from the registrations collection.
export const JOURNEY_STARTS_COLLECTION = 'ocr-journey-starts'
export const JOURNEY_NOT_ELIGIBLE_COLLECTION = 'ocr-journey-not-eligible'

// Magic-link email verification. One record per link issued; only the token's
// sha256 is stored. The rate-limit collection holds fixed-window counters keyed
// by an HMAC of the email, the journey id or 'global', never a plain address.
export const EMAIL_VERIFICATIONS_COLLECTION = 'ocr-email-verifications'
export const EMAIL_VERIFICATION_RATE_LIMITS_COLLECTION =
  'ocr-email-verification-rate-limits'
