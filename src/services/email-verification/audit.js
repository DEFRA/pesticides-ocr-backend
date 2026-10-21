import { audit } from '@defra/cdp-auditing'

import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'

const logger = createLogger()

// Without the secret the HMAC of a guessable address is as good as the
// address, so the hash is left out rather than written unkeyed.
function emailHashField(email) {
  const secret = config.get('emailVerification.hashSecret')
  return email && secret ? { emailHash: hashEmail(email, secret) } : {}
}

// Writes one audit event: `event`, `journeyId` when known, the keyed hash of
// `email` when there is one, and `details`. The address itself is never
// written, and callers pass no token, token hash or link. A failed write is
// logged and never fails the request.
export function auditEmailVerification(
  event,
  { journeyId, email, ...details } = {}
) {
  try {
    audit(
      {
        ...details,
        event,
        ...(journeyId ? { journeyId } : {}),
        ...emailHashField(email)
      },
      event
    )
  } catch (error) {
    logger.error({ err: error, event }, 'Could not write audit event')
  }
}
