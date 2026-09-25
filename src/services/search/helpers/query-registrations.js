import { findRegistrations } from '#/common/helpers/ocr-search.js'
import { buildSearchFilter } from './search-filter.js'

// Advanced search (EQ-366): registrations matching a free-text term, newest
// first. Returns the stored registrations unchanged — presenting them is the
// caller's job, so the same rows serve the case-officer view and the CSV export
// without either inheriting the other's shape. Collection access lives in the
// shared ocr-search helper; this layer supplies filter and sort.
export function queryRegistrations(db, { query = '', limit = 0 } = {}) {
  return findRegistrations(db, {
    filter: buildSearchFilter(query),
    sort: { submittedAt: -1 },
    limit
  })
}
