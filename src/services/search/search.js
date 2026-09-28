import { config } from '#/config.js'
import { getOneByReferenceNumber } from '#/common/helpers/ocr-search.js'
import { queryRegistrations } from './helpers/query-registrations.js'

// Controller for GET /search. One endpoint, two ways to ask:
//
//   basic     /search?reference=PPP-A1B-2C3   exact lookup, one record
//   advanced  /search?q=Norfolk               free-text match, newest first
//
// Both return stored registrations as-is. Presenting them (labels, defaults,
// formatting) belongs to the consumer, so the case-officer view and the CSV
// export can read the same rows without inheriting each other's shape.

// Cap on the advanced result set, matching what the case-officer grid pages
// through. The export asks for its own, larger bound (`export.maxRows`).
export const MAX_RESULTS = 500

// --- Basic reference lookup (EQ-366) ---------------------------------------

const REFERENCE_PATTERN = /^([A-Z0-9]+)-[A-Z0-9]{3}-[A-Z0-9]{3}$/

// The accepted prefix is the one registrations are generated with
// (`referencePrefix`), so the validator can't disagree with the generator.
function validateReferenceNumber(referenceNumber) {
  const match = REFERENCE_PATTERN.exec(referenceNumber)
  return match !== null && match[1] === config.get('referencePrefix')
}

// --- Shared resolution for both consumers of the contract ------------------

// /search and /export ask the same question and differ only in what they do
// with the answer, so the "which rows?" decision lives here once rather than
// being branched identically in both routes.
//
// Returns a tagged result instead of throwing, so this stays free of HTTP
// concerns and each route maps the outcome to its own status codes: /search
// 404s on a missing reference, while /export returns an empty file.
//
//   { invalidReference: true }  the reference is not a well-formed reference
//   { single: doc | null }      a reference was given
//   { list: [...] }             a free-text term was given (blank = everything)
export async function resolveQuery(
  db,
  { reference, q } = {},
  { limit = MAX_RESULTS } = {}
) {
  if (reference === undefined) {
    return { list: await queryRegistrations(db, { query: q, limit }) }
  }

  if (!validateReferenceNumber(reference)) {
    return { invalidReference: true }
  }

  return { single: await getOneByReferenceNumber(db, reference) }
}

export { getOneByReferenceNumber, validateReferenceNumber }
