import { countByMonth } from '#/services/metrics/helpers/count-by-month.js'
import { JOURNEY_NOT_ELIGIBLE } from '#/services/metrics/helpers/journey-events.js'

// Controller for GET /metrics/journey-not-eligible (EQ-472): applicants who
// exited via the "You do not need to use this service" page — a valid journey
// completion, counted from `endedAt`. Recording one is a separate, public
// endpoint (see the journey-not-eligible-events controller).
export async function countJourneyNotEligible(db, { from, to } = {}) {
  return countByMonth(db, { ...JOURNEY_NOT_ELIGIBLE, from, to })
}
