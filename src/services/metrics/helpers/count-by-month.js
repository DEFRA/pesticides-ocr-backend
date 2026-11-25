import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  FEEDBACK_STARTS_COLLECTION,
  FEEDBACK_RETURNS_COLLECTION
} from '#/common/constants/collections.js'
import {
  monthlyCountsPipeline,
  toMonthlyCounts
} from '#/common/helpers/monthly-counts.js'

// Only the metrics collections can be counted here. Registrations are counted
// through the audited repository, so their collection is deliberately not
// importable from this module.
const COUNTABLE_COLLECTIONS = new Set([
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  FEEDBACK_STARTS_COLLECTION,
  FEEDBACK_RETURNS_COLLECTION
])

export async function countByMonth(
  db,
  { collection, dateField, from, to } = {}
) {
  if (!COUNTABLE_COLLECTIONS.has(collection)) {
    throw new TypeError(
      `Only metrics collections can be counted here; count registrations through the audited repository (got ${collection})`
    )
  }
  const [result] = await db
    .collection(collection)
    .aggregate(monthlyCountsPipeline({ dateField, from, to }))
    .toArray()

  return toMonthlyCounts(result)
}
