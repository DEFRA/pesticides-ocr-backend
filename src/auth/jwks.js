import { createRemoteJWKSet } from 'jose'

// One remote JWKS per URI, created lazily and reused. jose's createRemoteJWKSet
// caches the fetched keys and handles key rotation (re-fetching on an unknown
// `kid`), so we must not build a new set per request.
const sets = new Map()

export function getJwks(jwksUri) {
  let set = sets.get(jwksUri)
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri))
    sets.set(jwksUri, set)
  }
  return set
}

// Test seam: clear the cache between cases.
export function resetJwks() {
  sets.clear()
}
