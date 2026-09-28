import { recordEvent } from '#/services/metrics/helpers/record-event.js'
import { JOURNEY_NOT_ELIGIBLE } from '#/services/metrics/helpers/journey-events.js'

// Controller for POST /metrics/journey-not-eligible (EQ-472) — the PUBLIC beacon
// that records a "not eligible" journey finish. Unauthenticated by design (the
// applicant journey has no bearer token), so the route guards it with a signed
// per-session token; see the beaconRoute options. Returns true when a new event
// was recorded, false when a replayed nonce was deduped.
export async function recordJourneyNotEligible(db, nonce) {
  return recordEvent(db, JOURNEY_NOT_ELIGIBLE, nonce)
}
