import { countRegistrations } from '#/services/metrics/registrations/registrations.js'
import { countRoute } from './helpers/route-options.js'

// GET /metrics/registrations — completions for the digital completion metric
// (EQ-472). Case-officer protected.
export const metricsRegistrations = [
  countRoute('/metrics/registrations', countRegistrations)
]
