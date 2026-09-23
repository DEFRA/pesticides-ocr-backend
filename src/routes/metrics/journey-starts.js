import { countJourneyStarts } from '#/services/metrics/journey-starts/journey-starts.js'
import { countRoute } from './helpers/route-options.js'

// GET /metrics/journey-starts — the completion-rate denominator (EQ-472).
// Case-officer protected. Recording a start is the separate public beacon in
// journey-start-events.js.
export const metricsJourneyStarts = [
  countRoute('/metrics/journey-starts', countJourneyStarts)
]
