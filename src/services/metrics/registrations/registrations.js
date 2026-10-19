import { SUBMITTED_AT } from '#/common/constants/registration.js'

// Controller for GET /metrics/registrations (EQ-472): completions — registrations
// counted from `submittedAt`. One call gives the dashboard its month / year /
// life-of-service views.
export async function countRegistrations({ registrations }, { from, to } = {}) {
  return registrations.countByMonth({
    dateField: SUBMITTED_AT,
    from,
    to,
    // A registration deleted later was still completed.
    includeDeleted: true
  })
}
