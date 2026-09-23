import { getOneByReferenceNumber } from '#/common/helpers/ocr-search.js'
import { toOperator } from '#/services/operators/helpers/operator-mapper.js'

// Controller for GET /operators/{reference} (EQ-385): one operator by its
// registration reference, or null if not found. Reuses the shared lookup (one
// lookup, one place), then maps the raw document to the Operator contract.
export async function getOperatorByReference(db, reference) {
  const doc = await getOneByReferenceNumber(db, reference)
  return doc ? toOperator(doc) : null
}
