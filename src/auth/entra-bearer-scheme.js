import Boom from '@hapi/boom'
import { decodeJwt, jwtVerify } from 'jose'

const BEARER_PREFIX = 'Bearer '

function extractBearerToken(request) {
  const header = request.headers.authorization
  if (!header?.startsWith(BEARER_PREFIX)) {
    return null
  }
  const token = header.slice(BEARER_PREFIX.length).trim()
  return token || null
}

// Map a verified/decoded token payload onto Hapi credentials. `scope` is set to
// the token's app roles so routes can authorise with Hapi's built-in scope
// checking (see require-role.js). Only the fields the app needs are exposed —
// the raw token claims (email, oid, tid, ipaddr, …) are deliberately NOT carried
// on credentials, so a handler that logs/returns credentials can't leak PII.
function toCredentials(payload) {
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  return {
    subject: payload.sub ?? '',
    name: payload.name ?? '',
    roles,
    scope: roles
  }
}

// Entra records granted delegated scopes in the space-delimited `scp` claim.
function tokenHasScope(payload, requiredScope) {
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : []
  return scopes.includes(requiredScope)
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
//   resolveEntra () => { issuer, audience, jwksUri, requiredScope }
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

      const { issuer, audience, requiredScope } = resolveEntra()

      let payload
      try {
        if (mode === 'live') {
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

      // Config-gated scope check: when a required API scope is configured, the
      // token must carry it in `scp`. Kept OUTSIDE the try/catch so an
      // authenticated-but-insufficient token surfaces as 403 (insufficient
      // scope), not the generic 401. Empty requiredScope = not enforced (accepts
      // the no-scope path until the scoped access token lands, EQ-442).
      if (requiredScope && !tokenHasScope(payload, requiredScope)) {
        request.log(
          ['auth'],
          `Bearer token missing required scope '${requiredScope}'`
        )
        // RFC 6750 §3.1: a valid-but-insufficient-scope token → 403 with a
        // WWW-Authenticate: Bearer error="insufficient_scope" challenge.
        const err = Boom.forbidden('Token is missing the required scope')
        err.output.headers['WWW-Authenticate'] =
          'Bearer error="insufficient_scope"'
        throw err
      }

      return h.authenticated({ credentials: toCredentials(payload) })
    }
  }
}
