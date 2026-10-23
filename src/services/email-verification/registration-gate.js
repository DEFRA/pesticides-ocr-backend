import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { MS_PER_SECOND } from '#/common/helpers/time.js'
import { REGISTRATION_EMAIL_NOT_VERIFIED } from '#/common/constants/audit-events.js'
import { auditEmailVerification } from '#/services/email-verification/audit.js'
import { normaliseEmail } from '#/services/email-verification/email-address.js'
import {
  METRICS,
  countEmailVerification
} from '#/services/email-verification/metrics.js'
import { findRecentVerification } from '#/services/email-verification/verification-records.js'

const logger = createLogger()

// Whether `email` was verified for this journey within the verified TTL, so a
// registration may be saved with it. A changed address, one
// verified on another journey and a stale verification all have no match. A
// refusal is logged by journey only, audited and counted.
export async function isEmailVerifiedForJourney(db, { journeyId, email }) {
  const normalised = normaliseEmail(email)
  const verifiedTtlSeconds = config.get('emailVerification.verifiedTtlSeconds')
  const since = new Date(Date.now() - verifiedTtlSeconds * MS_PER_SECOND)

  const verification = await findRecentVerification(db, {
    journeyId,
    email: normalised,
    since
  })
  if (verification) {
    return true
  }

  logger.info({ journeyId }, 'Registration refused: email not verified')
  auditEmailVerification(REGISTRATION_EMAIL_NOT_VERIFIED, {
    journeyId,
    email: normalised
  })
  countEmailVerification(METRICS.REGISTRATION_NOT_VERIFIED)
  return false
}
