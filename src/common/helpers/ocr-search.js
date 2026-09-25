import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'

// Read access to the ocr-registration collection: pure data access, no HTTP
// concerns or response shaping.

// Fetch one registration by its reference (raw stored document, `_id` omitted),
// or null.
export function getOneByReferenceNumber(db, referenceNumber) {
  return db
    .collection(OCR_REGISTRATION_COLLECTION)
    .findOne({ reference: referenceNumber }, { projection: { _id: 0 } })
}

// Find over the collection with a caller-supplied filter. `limit: 0` means
// "no cap" in Mongo.
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
