import { buildSearchFilter } from './search-filter.js'

// The /export free-text match: registrations matching a term, newest first.
// Returns the stored registrations unchanged; building the CSV is the caller's
// job.
export function queryRegistrations(registrations, { query = '', limit } = {}) {
  return registrations.search(buildSearchFilter(query), {
    sort: { submittedAt: -1 },
    limit
  })
}
