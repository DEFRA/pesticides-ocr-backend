// MongoDB collection names — single source of truth, so the collection name is
// not duplicated as a magic string across services and plugins.

export const OCR_REGISTRATION_COLLECTION = 'ocr-registration'

// Journey events recorded server-side, once per session, as the applicant moves
// through the journey — a consent-free basis for the completion rate (EQ-472).
// No PII: just a timestamp. Completions come from the registrations collection.
export const JOURNEY_STARTS_COLLECTION = 'ocr-journey-starts'
export const JOURNEY_NOT_ELIGIBLE_COLLECTION = 'ocr-journey-not-eligible'
export const EMAIL_VERIFICATION_COLLECTION = 'email-verifications'
