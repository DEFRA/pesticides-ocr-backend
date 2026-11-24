import Boom from '@hapi/boom'
import { decodeJwt, jwtVerify } from 'jose'

import { EXTERNAL_TOKEN_ISSUER } from '#/services/external-user/access-token.js'

import { IDENTITY_TYPE } from './strategy-name.js'

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
// `identityType` lets shared routes (e.g. registration GET/PATCH) branch on
// who is calling without caring which strategy authenticated the request —
// see also external-bearer-scheme.js, which produces the same shape.
function toCredentials(payload) {
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  return {
    identityType: IDENTITY_TYPE.INTERNAL,
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
// Both bearer schemes read the same Authorization header. Always
// (regardless of mode) refuse to treat a token this service itself minted
// for an external user as ours — otherwise mock mode (which doesn't check
// the Entra issuer at all) would happily authenticate an external-user
// token as "internal", skipping the record-level check entirely. In live
// mode, also require the token's issuer to match Entra's. Either way, throw
// with no message ("missing") so Hapi falls through to try external-bearer
// next, instead of a hard 401 that would stop it ever being tried — only a
// token that IS ours but fails signature/expiry later should get a real 401
// with a message.
function rejectIfNotOurs(request, token, { mode, issuer }) {
  let unverifiedPayload
  try {
    unverifiedPayload = decodeJwt(token)
  } catch (err) {
    request.log(
      ['auth'],
      `Bearer token not handled by entra-bearer: not a decodable JWT (${err.message})`
    )
    throw Boom.unauthorized(null, 'Bearer')
  }
  const looksForeign =
    unverifiedPayload.iss === EXTERNAL_TOKEN_ISSUER ||
    (mode === 'live' && issuer && unverifiedPayload.iss !== issuer)
  if (looksForeign) {
    request.log(
      ['auth'],
      `Bearer token not handled by entra-bearer: issuer '${unverifiedPayload.iss}' is not an Entra issuer`
    )
    throw Boom.unauthorized(null, 'Bearer')
  }
}

export function entraBearerScheme(_server, options = {}) {
  const { mode, resolveEntra, getKeySet } = options

  return {
    async authenticate(request, h) {
      const token = extractBearerToken(request)
      if (!token) {
        throw Boom.unauthorized('Missing bearer token', 'Bearer')
      }

      const { issuer, audience, requiredScope } = resolveEntra()
      rejectIfNotOurs(request, token, { mode, issuer })

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
