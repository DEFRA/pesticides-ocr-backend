import { recordJourneyStart } from '#/services/metrics/journey-start-events/journey-start-events.js'
import { beaconRoute } from './helpers/route-options.js'

// POST /metrics/journey-starts — PUBLIC beacon recording a journey start
// (EQ-472). Unauthenticated by design; guarded by the signed per-session
// journey token when the shared secret is configured (see beaconRoute).
export const metricsJourneyStartEvents = [
  beaconRoute('/metrics/journey-starts', recordJourneyStart, 'journey start')
]
