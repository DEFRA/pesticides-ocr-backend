import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import { countByMonth } from '#/services/metrics/helpers/count-by-month.js'

// Controller for GET /metrics/registrations (EQ-472): completions — registrations
// counted from `submittedAt`. One call gives the dashboard its month / year /
// life-of-service views.
export async function countRegistrations(db, { from, to } = {}) {
  return countByMonth(db, {
    collection: OCR_REGISTRATION_COLLECTION,
    dateField: 'submittedAt',
    from,
    to
  })
}
