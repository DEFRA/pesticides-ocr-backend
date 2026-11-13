import Boom from '@hapi/boom'

import { verifyExternalAccessToken } from '#/services/external-user/access-token.js'

const BEARER_PREFIX = 'Bearer '

function extractBearerToken(request) {
  const header = request.headers.authorization
  if (!header?.startsWith(BEARER_PREFIX)) {
    return null
  }
  const token = header.slice(BEARER_PREFIX.length).trim()
  return token || null
}

// Maps a verified external-user token payload onto Hapi credentials, in the
// same shape entra-bearer produces (subject, roles, scope) plus the one extra
// field this strategy's credentials carry: registrationReference, the single
// record the token is scoped to. `scope` drives Hapi's route-level role check
// (requireExternalUser); registrationReference is read by
// requireOwnRegistration for the record-level check — role alone is never
// enough for this population.
function toCredentials(payload) {
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  return {
    subject: payload.sub ?? '',
    registrationReference: payload.reference ?? '',
    roles,
    scope: roles
  }
}

// A Hapi auth scheme for the external-user access token issued after email
// verification (see services/external-user/access-token.js). Always
// signature-verified — there is no mock mode for this strategy, unlike
// entra-bearer: an external-user token is minted by this service itself, so
// there is no "no live IdP yet" case to work around locally.
//
// Any failure (missing header, bad signature, wrong issuer/audience/algorithm,
// expired) is surfaced as the same generic 401, so a caller can't learn which
// check failed (AC2 of the completion ticket).
export function externalBearerScheme() {
  return {
    async authenticate(request, h) {
      const token = extractBearerToken(request)
      if (!token) {
        throw Boom.unauthorized('Missing bearer token', 'Bearer')
      }

      let payload
      try {
        payload = await verifyExternalAccessToken(token)
      } catch (err) {
        request.log(
          ['auth', 'error'],
          `External bearer token rejected: ${err.message}`
        )
        throw Boom.unauthorized('Invalid bearer token', 'Bearer')
      }

      return h.authenticated({ credentials: toCredentials(payload) })
    }
  }
}
