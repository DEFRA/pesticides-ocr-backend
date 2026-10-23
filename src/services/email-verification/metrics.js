import { Metrics } from '@defra/cdp-metrics'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { EMAIL_VERIFICATION_METRICS } from '#/common/constants/email-verification.js'

const logger = createLogger()
const metrics = new Metrics(logger)

// Re-exported for existing imports; the canonical definition lives in
// common/constants/email-verification.js.
export const METRICS = EMAIL_VERIFICATION_METRICS

// Counts one occurrence. Not awaited, so a slow or failing flush neither
// delays nor fails the request.
export function countEmailVerification(name, dimensions = {}) {
  Promise.resolve()
    .then(() => metrics.counter(name, 1, dimensions))
    .catch((error) => {
      logger.warn({ err: error, metric: name }, 'Could not record metric')
    })
}
