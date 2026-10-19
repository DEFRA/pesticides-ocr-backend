import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import {
  monthlyCountsPipeline,
  toMonthlyCounts
} from '#/common/helpers/monthly-counts.js'

// The volume metrics for collections other than registrations, which are
// counted through the audited repository instead.
export async function countByMonth(
  db,
  { collection, dateField, from, to } = {}
) {
  if (collection === OCR_REGISTRATION_COLLECTION) {
    throw new TypeError(
      'Count registrations through the audited repository, the only access path for them'
    )
  }
  const [result] = await db
    .collection(collection)
    .aggregate(monthlyCountsPipeline({ dateField, from, to }))
    .toArray()

  return toMonthlyCounts(result)
}
