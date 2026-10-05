import {
  searchFields,
  WILDCARD,
  collapseWildcards
} from '#/common/helpers/search-terms.js'

// Escape a user-supplied string for safe use inside a RegExp (prevents the
// search term being interpreted as a pattern / ReDoS).
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

const anyField = (matcher) =>
  Object.values(searchFields).map((field) => ({ [field]: matcher }))

export function buildSearchFilter(query) {
  const term = (query ?? '').trim()
  if (!term) {
    return {}
  }
  return { $or: anyField(new RegExp(escapeRegExp(term), 'i')) }
}

function toPartialMatch(term) {
  const pattern = collapseWildcards(term)
    .split(WILDCARD)
    .map(escapeRegExp)
    .join('.*')
  return new RegExp(pattern, 'i')
}

export function buildCriteriaFilter({ q, ...criteria } = {}) {
  const clauses = Object.entries(searchFields)
    .filter(([name]) => criteria[name])
    .map(([name, field]) => ({ [field]: toPartialMatch(criteria[name]) }))

  if (q) {
    clauses.unshift({ $or: anyField(toPartialMatch(q)) })
  }

  return clauses.length > 0 ? { $and: clauses } : {}
}
