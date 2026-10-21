// Checks that span more than one email verification setting, which a convict
// format can't see. Run after config.validate so the app refuses to start.

// Links carry a live token, so they must be https anywhere but a developer's
// machine. The value is an origin because the link path is appended to it.
function validateLinkBaseUrl(value, cdpEnvironment) {
  if (value === '') {
    return
  }

  const key = 'emailVerification.linkBaseUrl'
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${key}: must be a URL like https://example.gov.uk`)
  }

  const allowed = cdpEnvironment === 'local' ? ['https:', 'http:'] : ['https:']
  if (!allowed.includes(url.protocol)) {
    throw new Error(`${key}: must use https outside the local tier`)
  }
  if (url.origin !== value) {
    throw new Error(`${key}: must be an origin, with no path or trailing slash`)
  }
}

// A link can be verified up to linkTtlSeconds after it's sent, and the
// verification then counts for verifiedTtlSeconds, so the record must be kept
// for both.
function validateRetention({
  linkTtlSeconds,
  verifiedTtlSeconds,
  recordRetentionSeconds
}) {
  const minimum = linkTtlSeconds + verifiedTtlSeconds
  if (recordRetentionSeconds < minimum) {
    throw new Error(
      `emailVerification.recordRetentionSeconds: must be at least linkTtlSeconds + verifiedTtlSeconds (${minimum})`
    )
  }
}

export function validateEmailVerificationConfig(config) {
  const settings = config.get('emailVerification')
  validateLinkBaseUrl(settings.linkBaseUrl, config.get('cdpEnvironment'))
  validateRetention(settings)
}
