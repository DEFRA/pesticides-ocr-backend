import { recordEvent } from '#/services/metrics/helpers/record-event.js'
import { JOURNEY_STARTS } from '#/services/metrics/helpers/journey-events.js'

// Controller for POST /metrics/journey-starts (EQ-472) — the PUBLIC beacon that
// records a journey start. Unauthenticated by design (the applicant journey has
// no bearer token), so the route guards it with a signed per-session token; see
// the beaconRoute options. Returns true when a new event was recorded, false
// when a replayed nonce was deduped.
export async function recordJourneyStart(db, nonce) {
  return recordEvent(db, JOURNEY_STARTS, nonce)
}
