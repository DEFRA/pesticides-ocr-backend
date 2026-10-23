import { config } from '#/config.js'
import { CURRENT_VERIFICATION_STATUS } from '#/common/constants/email-verification.js'
import { addSeconds } from '#/common/helpers/time.js'
import {
  STATUS,
  findLatestRecord,
  findRecentVerification
} from '#/services/email-verification/verification-records.js'

// Re-exported for existing imports; the canonical definition lives in
// common/constants/email-verification.js.
export const CURRENT_STATUS = CURRENT_VERIFICATION_STATUS

// The state of the journey's latest link, for the browser that requested it to
// pick up a verification made elsewhere. `verified` means the address the
// latest link went to was verified for this journey within the verified TTL,
// whichever of its links was used. A link that can no longer be used for any
// other reason (expired, or a verification that is too old) is `expired`, as
// the applicant needs a new one either way. Dates are null when there's no link.
export async function currentVerificationStatus(db, { journeyId }) {
  const settings = config.get('emailVerification')
  const now = new Date()

  const latest = await findLatestRecord(db, journeyId)
  if (!latest) {
    return {
      status: CURRENT_STATUS.NONE,
      expiresAt: null,
      verifiedAt: null,
      resendAvailableAt: null
    }
  }

  const verification = await findRecentVerification(db, {
    journeyId,
    email: latest.email,
    since: addSeconds(now, -settings.verifiedTtlSeconds)
  })

  let status
  if (verification) {
    status = CURRENT_STATUS.VERIFIED
  } else if (latest.status === STATUS.PENDING && latest.expiresAt > now) {
    status = CURRENT_STATUS.PENDING
  } else {
    status = CURRENT_STATUS.EXPIRED
  }

  return {
    status,
    expiresAt: latest.expiresAt,
    verifiedAt: verification?.verifiedAt ?? null,
    // The cooldown is claimed with the same timestamp the record is created
    // with, so it ends this long after createdAt.
    resendAvailableAt: addSeconds(
      latest.createdAt,
      settings.resendCooldownSeconds
    )
  }
}
