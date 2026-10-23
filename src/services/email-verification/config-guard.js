import { config } from '#/config.js'

// Settings email verification can't work without, by env var name. Each
// defaults to empty so no environment-specific value lives in code; a request
// on a tier missing any of them is refused rather than half-working.
const REQUIRED_SETTINGS = [
  ['journeyToken.secret', 'JOURNEY_TOKEN_SECRET'],
  ['emailVerification.hashSecret', 'EMAIL_VERIFICATION_HASH_SECRET'],
  ['emailVerification.linkBaseUrl', 'EMAIL_VERIFICATION_LINK_BASE_URL'],
  ['notify.apiKey', 'NOTIFY_API_KEY'],
  [
    'notify.templates.emailVerificationLink',
    'NOTIFY_TEMPLATE_EMAIL_VERIFICATION_LINK'
  ]
]

export function missingEmailVerificationSettings() {
  return REQUIRED_SETTINGS.filter(([key]) => !config.get(key)).map(
    ([, envName]) => envName
  )
}

// Warn at boot, once per missing setting, so a deployed tier that can't verify
// emails is noticed before an applicant hits it. Names only, never values.
export function warnIfEmailVerificationUnconfigured(server) {
  if (config.get('cdpEnvironment') === 'local') {
    return
  }

  for (const envName of missingEmailVerificationSettings()) {
    server.log(
      ['email-verification', 'warn'],
      `${envName} is not configured — email verification requests will be refused`
    )
  }
}

// The /register gate is only meant to be off while a tier's frontend catches
// up, so a deployed tier running without it is flagged at every boot.
export function warnIfRegistrationGateDisabled(server) {
  if (
    config.get('cdpEnvironment') === 'local' ||
    config.get('emailVerification.requiredForRegistration')
  ) {
    return
  }

  server.log(
    ['email-verification', 'warn'],
    'EMAIL_VERIFICATION_REQUIRED_FOR_REGISTRATION is false — POST /register accepts unverified email addresses'
  )
}
