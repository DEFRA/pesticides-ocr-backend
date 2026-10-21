import { Metrics } from '@defra/cdp-metrics'

import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()
const metrics = new Metrics(logger)

export const METRICS = {
  LINK_SENT: 'emailVerificationLinkSent',
  SEND_FAILED: 'emailVerificationSendFailed',
  RATE_LIMITED: 'emailVerificationRateLimited',
  VERIFIED: 'emailVerificationVerified',
  REJECTED: 'emailVerificationRejected',
  REGISTRATION_NOT_VERIFIED: 'registrationEmailNotVerified'
}

// Counts one occurrence. Not awaited, so a slow or failing flush neither
// delays nor fails the request.
export function countEmailVerification(name, dimensions = {}) {
  Promise.resolve()
    .then(() => metrics.counter(name, 1, dimensions))
    .catch((error) => {
      logger.warn({ err: error, metric: name }, 'Could not record metric')
    })
}
