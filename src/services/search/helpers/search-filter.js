// Escape a user-supplied string for safe use inside a RegExp (prevents the
// search term being interpreted as a pattern / ReDoS).
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

// Build the Mongo filter for a search term: case-insensitive match across the
// contract's searchable fields. A blank/absent term matches everything.
export function buildSearchFilter(query) {
  const term = (query ?? '').trim()
  if (!term) {
    return {}
  }
  const rx = new RegExp(escapeRegExp(term), 'i')
  return {
    $or: [
      { reference: rx },
      { businessName: rx },
      // Stored (payload) field names, not the Operator contract's — see the mapper.
      { 'primaryContact.contactName': rx },
      { 'address.addressTown': rx },
      { 'address.addressPostcode': rx }
    ]
  }
}
