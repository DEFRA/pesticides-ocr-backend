import { queryOperators } from '#/services/operators/helpers/query-operators.js'

// Controller for GET /operators (EQ-385): the case-officer dashboard grid —
// list/search registered operators, capped for the paged grid. The shared query
// (search filter + Operator mapping) lives in helpers/query-operators.js.

// Cap the grid result set until real pagination lands (EQ-385 follow-up).
// Exported so callers/tests reference the single source of truth, not a literal.
export const MAX_RESULTS = 500

export function searchOperators(db, { query = '' } = {}) {
  return queryOperators(db, { query, limit: MAX_RESULTS })
}
