// Email-verification record status, shared by the records store, the
// current-status check, test fixtures and any route that inspects a record.
export const VERIFICATION_STATUS = {
  SENDING: 'sending',
  PENDING: 'pending',
  VERIFIED: 'verified',
  SUPERSEDED: 'superseded'
}

// The state of a journey's latest verification link, as returned by
// GET /email-verifications/current. A frontend contract value.
export const CURRENT_VERIFICATION_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  EXPIRED: 'expired',
  VERIFIED: 'verified'
}

// Rate-limit bucket names used in Mongo document ids, audit records and
// metrics dimensions.
export const RATE_LIMITS = {
  COOLDOWN: 'cooldown',
  EMAIL: 'email',
  JOURNEY: 'journey',
  GLOBAL: 'global'
}

// Metric names emitted for email verification events.
export const EMAIL_VERIFICATION_METRICS = {
  LINK_SENT: 'emailVerificationLinkSent',
  SEND_FAILED: 'emailVerificationSendFailed',
  RATE_LIMITED: 'emailVerificationRateLimited',
  VERIFIED: 'emailVerificationVerified',
  REJECTED: 'emailVerificationRejected',
  REGISTRATION_NOT_VERIFIED: 'registrationEmailNotVerified'
}

// The frontend page the magic link in the verification email points at. A
// contract with the frontend, not an implementation detail of request-link.js.
export const VERIFY_EMAIL_PATH = '/verify-email'
