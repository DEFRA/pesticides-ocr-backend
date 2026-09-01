import { describe, test, expect, beforeEach } from 'vitest'

import { getJwks, resetJwks } from './jwks.js'

// createRemoteJWKSet is lazy (it only fetches on first verification), so building
// the set here does not hit the network.
const URI_A = 'https://login.microsoftonline.com/tenant-a/discovery/v2.0/keys'
const URI_B = 'https://login.microsoftonline.com/tenant-b/discovery/v2.0/keys'

describe('getJwks', () => {
  beforeEach(() => {
    resetJwks()
  })

  test('returns the same cached instance for the same URI', () => {
    expect(getJwks(URI_A)).toBe(getJwks(URI_A))
  })

  test('returns a different instance per URI', () => {
    expect(getJwks(URI_A)).not.toBe(getJwks(URI_B))
  })

  test('resetJwks clears the cache so a fresh instance is built', () => {
    const first = getJwks(URI_A)
    resetJwks()
    expect(getJwks(URI_A)).not.toBe(first)
  })
})
