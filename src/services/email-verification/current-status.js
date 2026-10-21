import { config } from '#/config.js'
import {
  STATUS,
  findLatestRecord,
  findRecentVerification
} from '#/services/email-verification/verification-records.js'

export const CURRENT_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  EXPIRED: 'expired',
  VERIFIED: 'verified'
}

const MS_PER_SECOND = 1000

const addSeconds = (date, seconds) =>
  new Date(date.getTime() + seconds * MS_PER_SECOND)

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

  let status = CURRENT_STATUS.EXPIRED
  if (verification) {
    status = CURRENT_STATUS.VERIFIED
  } else if (latest.status === STATUS.PENDING && latest.expiresAt > now) {
    status = CURRENT_STATUS.PENDING
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
