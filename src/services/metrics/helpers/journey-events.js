import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION
} from '#/common/constants/collections.js'

// Each journey event is defined once here — the collection it lives in and the
// timestamp field it is keyed on — so the read controller (which counts it) and
// the write controller (which records it) share one definition rather than
// repeating the collection/field pair.

export const JOURNEY_STARTS = {
  collection: JOURNEY_STARTS_COLLECTION,
  dateField: 'startedAt'
}

// Applicants who exit via the "You do not need to use this service" page — a
// valid journey completion, counted separately from registrations.
export const JOURNEY_NOT_ELIGIBLE = {
  collection: JOURNEY_NOT_ELIGIBLE_COLLECTION,
  dateField: 'endedAt'
}
