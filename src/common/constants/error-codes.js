// Stable, machine-readable `code` values added to Boom error payloads. The
// frontend branches on these, never on the message text.
export const JOURNEY_TOKEN_INVALID = 'JOURNEY_TOKEN_INVALID'
export const SERVICE_NOT_CONFIGURED = 'SERVICE_NOT_CONFIGURED'
export const VALIDATION_ERROR = 'VALIDATION_ERROR'
// One code for every send cap, so a 429 doesn't reveal which one was hit or
// anything about another applicant's address.
export const RATE_LIMITED = 'RATE_LIMITED'
export const RESEND_COOLDOWN = 'RESEND_COOLDOWN'
export const EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED'
// Magic-link outcomes (POST /email-verifications/verify). A malformed token and
// an unknown one share TOKEN_INVALID: the applicant can't act differently.
export const TOKEN_INVALID = 'TOKEN_INVALID'
export const TOKEN_EXPIRED = 'TOKEN_EXPIRED'
export const TOKEN_SUPERSEDED = 'TOKEN_SUPERSEDED'
export const TOKEN_ALREADY_USED = 'TOKEN_ALREADY_USED'
export const VERIFICATION_FAILED = 'VERIFICATION_FAILED'
// POST /register: the contact email has no recent verification for this
// journey. One code for every reason, as the applicant's fix is the same.
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED'
