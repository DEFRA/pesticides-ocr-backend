import { recordJourneyNotEligible } from '#/services/metrics/journey-not-eligible-events/journey-not-eligible-events.js'
import { beaconRoute } from './helpers/route-options.js'

// POST /metrics/journey-not-eligible — PUBLIC beacon recording a "not eligible"
// journey finish (EQ-472). Unauthenticated by design; guarded by the signed
// per-session journey token when the shared secret is configured.
export const metricsJourneyNotEligibleEvents = [
  beaconRoute(
    '/metrics/journey-not-eligible',
    recordJourneyNotEligible,
    'not-eligible finish'
  )
]
