import { findRegistrations } from '#/common/helpers/ocr-search.js'
import { toOperator } from './operator-mapper.js'
import { buildSearchFilter } from './search-filter.js'

// The dashboard's shared read query (EQ-385): registrations matching a free-text
// search term, newest first, mapped onto the Operator contract. The list
// controller caps it for the paged grid; the export controller passes limit 0
// (Mongo's "no cap") to get the full matching set. Collection access lives in
// the shared ocr-search helper; this layer supplies the filter and
// the mapping.
export async function queryOperators(db, { query = '', limit = 0 } = {}) {
  const docs = await findRegistrations(db, {
    filter: buildSearchFilter(query),
    sort: { submittedAt: -1 },
    limit
  })
  return docs.map(toOperator)
}
