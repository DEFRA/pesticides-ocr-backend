import { countByMonth } from '#/services/metrics/helpers/count-by-month.js'
import { JOURNEY_STARTS } from '#/services/metrics/helpers/journey-events.js'

// Controller for GET /metrics/journey-starts (EQ-472): journey starts — the
// completion-rate denominator. Recording a start is a separate, public endpoint
// (see the journey-start-events controller).
export async function countJourneyStarts(db, { from, to } = {}) {
  return countByMonth(db, { ...JOURNEY_STARTS, from, to })
}
