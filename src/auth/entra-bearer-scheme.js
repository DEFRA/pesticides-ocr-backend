import Boom from '@hapi/boom'
import { decodeJwt, jwtVerify } from 'jose'

const BEARER_PREFIX = 'Bearer '

function extractBearerToken(request) {
  const header = request.headers.authorization
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return null
  }
  const token = header.slice(BEARER_PREFIX.length).trim()
  return token || null
}

// Map a verified/decoded token payload onto Hapi credentials. `scope` is set to
// the token's app roles so routes can authorise with Hapi's built-in scope
// checking (see require-role.js).
function toCredentials(payload) {
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  return {
    subject: payload.sub ?? '',
    name: payload.name ?? '',
    roles,
    scope: roles,
    claims: payload
  }
}

// A Hapi auth scheme that authenticates a request from its `Authorization:
// Bearer <jwt>` header.
//
// - live: verify the JWT signature against the Entra JWKS, and check issuer +
//   audience + expiry (jose enforces exp/nbf). Fail closed on any error.
// - mock: decode the JWT WITHOUT verifying the signature (local/CI only) so the
//   API can be exercised without a live IdP.
//
// options:
//   mode        'mock' | 'live'
//   resolveEntra () => { issuer, audience, jwksUri }
//   getKeySet    () => key input for jose.jwtVerify (defaults to the remote
//                JWKS; overridable in tests to avoid a network fetch)
export function entraBearerScheme(_server, options = {}) {
  const { mode, resolveEntra, getKeySet } = options

  return {
    async authenticate(request, h) {
      const token = extractBearerToken(request)
      if (!token) {
        throw Boom.unauthorized('Missing bearer token', 'Bearer')
      }

      let payload
      try {
        if (mode === 'live') {
          const { issuer, audience } = resolveEntra()
          // Fail closed: without a configured issuer AND audience, jose would
          // skip those checks — never verify a token then.
          if (!issuer || !audience) {
            throw new Error('Entra validation is not configured')
          }
          const verified = await jwtVerify(token, getKeySet(), {
            issuer,
            audience,
            algorithms: ['RS256']
          })
          payload = verified.payload
        } else {
          payload = decodeJwt(token)
        }
      } catch (err) {
        // Keep the specific reason server-side; return a generic 401 so the
        // client can't probe why a token was rejected.
        request.log(['auth', 'error'], `Bearer token rejected: ${err.message}`)
        throw Boom.unauthorized('Invalid bearer token', 'Bearer')
      }

      return h.authenticated({ credentials: toCredentials(payload) })
    }
  }
}
