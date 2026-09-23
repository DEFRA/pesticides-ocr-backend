import { countJourneyNotEligible } from '#/services/metrics/journey-not-eligible/journey-not-eligible.js'
import { countRoute } from './helpers/route-options.js'

// GET /metrics/journey-not-eligible — applicants who exited via the "You do not
// need to use this service" page (EQ-472). Case-officer protected. Recording one
// is the separate public beacon in journey-not-eligible-events.js.
export const metricsJourneyNotEligible = [
  countRoute('/metrics/journey-not-eligible', countJourneyNotEligible)
]
