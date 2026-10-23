import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { loggableError } from '#/common/helpers/loggable-error.js'
import {
  EMAIL_VERIFICATION_LINK_REQUESTED,
  EMAIL_VERIFICATION_LINK_SEND_FAILED,
  EMAIL_VERIFICATION_LINK_SENT,
  EMAIL_VERIFICATION_RATE_LIMITED
} from '#/common/constants/audit-events.js'
import { VERIFY_EMAIL_PATH } from '#/common/constants/email-verification.js'
import { NotifySendError, sendEmail } from '#/services/notify/notify.js'
import { auditEmailVerification } from '#/services/email-verification/audit.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'
import { generateLinkToken } from '#/services/email-verification/link-token.js'
import {
  METRICS,
  countEmailVerification
} from '#/services/email-verification/metrics.js'
import {
  releaseSend,
  reserveSend
} from '#/services/email-verification/rate-limiter.js'
import {
  activateRecord,
  deleteSendingRecord,
  insertSendingRecord
} from '#/services/email-verification/verification-records.js'

const logger = createLogger()

const TEMPLATE_NAME = 'emailVerificationLink'
const SECONDS_PER_MINUTE = 60

// The link and its expiry are the only personalisation: no names and no
// submission data.
function personalisation(token, settings) {
  return {
    verification_link: `${settings.linkBaseUrl}${VERIFY_EMAIL_PATH}?token=${token}`,
    expiry_minutes: Math.max(
      1,
      Math.floor(settings.linkTtlSeconds / SECONDS_PER_MINUTE)
    )
  }
}

// Puts things back as they were before the request: no record, no quota used.
// Best effort, because the caller is already failing with the original error.
async function undoSend(db, recordId, reservation) {
  const results = await Promise.allSettled([
    ...(recordId ? [deleteSendingRecord(db, recordId)] : []),
    releaseSend(db, reservation)
  ])
  for (const { status, reason } of results) {
    if (status === 'rejected') {
      logger.error(
        loggableError(reason),
        'Could not undo a failed email verification send'
      )
    }
  }
}

// What went wrong, as Notify's error type (BadRequestError, RateLimitError…)
// or the network error code, never Notify's free-text message.
const sendFailureReason = (error) =>
  error.errors?.[0]?.error ?? error.code ?? 'UNKNOWN'

function recordSendFailure(error, { journeyId, email }) {
  if (!(error instanceof NotifySendError)) {
    return
  }
  auditEmailVerification(EMAIL_VERIFICATION_LINK_SEND_FAILED, {
    journeyId,
    email,
    reason: sendFailureReason(error)
  })
  countEmailVerification(METRICS.SEND_FAILED)
}

// Sends a new magic link to `email` for the journey and supersedes the
// journey's earlier links: cooldown and counters, then a `sending` record, then
// Notify, then activation. Resolves to { sent: true, expiresAt,
// resendAvailableAt } or { sent: false, limit, retryAfterSeconds }. Rejects
// with the NotifySendError if Notify fails, after undoing the record and quota.
export async function requestVerificationLink(
  { client, db },
  { journeyId, email }
) {
  const settings = config.get('emailVerification')
  const now = new Date()
  const emailHash = hashEmail(email, settings.hashSecret)
  auditEmailVerification(EMAIL_VERIFICATION_LINK_REQUESTED, {
    journeyId,
    email
  })

  const decision = await reserveSend(db, {
    journeyId,
    emailHash,
    now,
    settings
  })
  if (!decision.allowed) {
    logger.info(
      { journeyId, limit: decision.limit },
      'Email verification request rate limited'
    )
    auditEmailVerification(EMAIL_VERIFICATION_RATE_LIMITED, {
      journeyId,
      email,
      limit: decision.limit
    })
    countEmailVerification(METRICS.RATE_LIMITED, { limit: decision.limit })
    return {
      sent: false,
      limit: decision.limit,
      retryAfterSeconds: decision.retryAfterSeconds
    }
  }

  const { token, tokenHash } = generateLinkToken()
  let record
  try {
    record = await insertSendingRecord(db, {
      journeyId,
      email,
      tokenHash,
      now,
      settings
    })
    await sendEmail(TEMPLATE_NAME, email, personalisation(token, settings))
  } catch (error) {
    recordSendFailure(error, { journeyId, email })
    await undoSend(db, record?._id, decision.reservation)
    throw error
  }

  await activateRecord(
    { client, db },
    { _id: record._id, journeyId, now: new Date() }
  )
  logger.info({ journeyId }, 'Email verification link sent')
  auditEmailVerification(EMAIL_VERIFICATION_LINK_SENT, {
    journeyId,
    email,
    expiresAt: record.expiresAt.toISOString()
  })
  countEmailVerification(METRICS.LINK_SENT)

  return {
    sent: true,
    expiresAt: record.expiresAt,
    resendAvailableAt: decision.resendAvailableAt
  }
}
