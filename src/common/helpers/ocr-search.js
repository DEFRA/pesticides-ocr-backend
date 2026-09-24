import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'

// Shared read access to the ocr-registration collection. Both the Search API
// (basic reference lookup) and the Dashboard read API build on these, so the
// collection access lives here once rather than in either service. Pure data
// access: no HTTP concerns, no API-specific shaping (that stays in the services).

// Fetch one registration by its reference (raw stored document, `_id` omitted),
// or null.
export function getOneByReferenceNumber(db, referenceNumber) {
  return db
    .collection(OCR_REGISTRATION_COLLECTION)
    .findOne({ reference: referenceNumber }, { projection: { _id: 0 } })
}

// Generic find over the collection. The caller supplies the filter (e.g. the
// dashboard's multi-field search filter) so this stays API-agnostic. `limit: 0`
// means "no cap" (Mongo), so callers should always pass a bound.
export function findRegistrations(
  db,
  { filter = {}, sort = {}, limit = 0 } = {}
) {
  return db
    .collection(OCR_REGISTRATION_COLLECTION)
    .find(filter, { projection: { _id: 0 } })
    .sort(sort)
    .limit(limit)
    .toArray()
}
