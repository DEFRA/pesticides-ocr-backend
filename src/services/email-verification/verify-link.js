import { createLogger } from '#/common/helpers/logging/logger.js'
import { config } from '#/config.js'
import {
  EMAIL_VERIFICATION_REJECTED,
  EMAIL_VERIFICATION_VERIFIED
} from '#/common/constants/audit-events.js'
import {
  TOKEN_ALREADY_USED,
  TOKEN_EXPIRED,
  TOKEN_INVALID,
  TOKEN_SUPERSEDED
} from '#/common/constants/error-codes.js'
import { auditEmailVerification } from '#/services/email-verification/audit.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'
import { hashLinkToken } from '#/services/email-verification/link-token.js'
import {
  METRICS,
  countEmailVerification
} from '#/services/email-verification/metrics.js'
import {
  STATUS,
  findByTokenHash,
  markVerified
} from '#/services/email-verification/verification-records.js'

const logger = createLogger()

// Why a link that didn't verify can't be used. Only read after the atomic
// update has failed, so it decides the error but can never let a link through.
// A record still `sending`, or `pending` but unexpired (it went live after the
// update ran), has not been sent yet as far as verify is concerned.
function rejection(record, now) {
  if (record?.status === STATUS.VERIFIED) {
    return TOKEN_ALREADY_USED
  }
  if (record?.status === STATUS.SUPERSEDED) {
    return TOKEN_SUPERSEDED
  }
  if (record?.status === STATUS.PENDING && record.expiresAt <= now) {
    return TOKEN_EXPIRED
  }
  return TOKEN_INVALID
}

// Audits and counts a link that didn't verify. Exported for the route, which
// rejects a malformed token before it reaches verifyLinkToken.
export function recordVerifyRejected({ journeyId, email, code }) {
  auditEmailVerification(EMAIL_VERIFICATION_REJECTED, {
    journeyId,
    email,
    code
  })
  countEmailVerification(METRICS.REJECTED, { outcome: code })
}

// Derives a stable external-user "subject" from a verified email address —
// an HMAC, like the rate-limit keys, so the raw address is never carried on
// credentials, but the same address always maps to the same subject (needed
// so a later re-verification matches the same registration-access grant).
function subjectForEmail(email) {
  const secret = config.get('emailVerification.hashSecret')
  return hashEmail(email, secret)
}

// Verifies the email address a magic link was sent to, for the journey that
// requested it. `journeyId` is the caller's journey, or null: it only decides
// `sameJourney`, so a link opened in another browser still verifies. Resolves
// to { verified: true, sameJourney, subject, email } or
// { verified: false, code, sameJourney }.
//
// `email` is returned (not just its hash/subject) only so the caller can run
// an entitlement check against a registration's contact email immediately
// after verification — proving control of an inbox is not, by itself,
// entitlement to any particular registration (completion ticket AC1). It must
// never be put on a response payload or a token claim.
export async function verifyLinkToken(db, { token, journeyId }) {
  const tokenHash = hashLinkToken(token)
  const now = new Date()
  const isSameJourney = (candidate) =>
    journeyId !== null && candidate?.journeyId === journeyId

  const verified = await markVerified(db, { tokenHash, now })
  if (verified) {
    const verifiedSameJourney = isSameJourney(verified)
    logger.info(
      { journeyId: verified.journeyId, sameJourney: verifiedSameJourney },
      'Email verification link verified'
    )
    auditEmailVerification(EMAIL_VERIFICATION_VERIFIED, {
      journeyId: verified.journeyId,
      email: verified.email,
      sameJourney: verifiedSameJourney
    })
    countEmailVerification(METRICS.VERIFIED)
    return {
      verified: true,
      sameJourney: verifiedSameJourney,
      subject: subjectForEmail(verified.email),
      email: verified.email
    }
  }

  const record = await findByTokenHash(db, tokenHash)
  const code = rejection(record, now)
  const sameJourney = isSameJourney(record)
  logger.info(
    { journeyId: record?.journeyId, code },
    'Email verification link rejected'
  )
  recordVerifyRejected({
    journeyId: record?.journeyId ?? journeyId,
    email: record?.email,
    code
  })
  return { verified: false, code, sameJourney }
}
