import { findRegistrations } from '#/common/helpers/ocr-search.js'
import { buildSearchFilter } from './search-filter.js'

// The /export free-text match: registrations matching a term, newest first.
// Returns the stored registrations unchanged; building the CSV is the caller's
// job. Collection access lives in the shared ocr-search helper; this layer
// supplies filter and sort.
export function queryRegistrations(db, { query = '', limit = 0 } = {}) {
  return findRegistrations(db, {
    filter: buildSearchFilter(query),
    sort: { submittedAt: -1 },
    limit
  })
}
