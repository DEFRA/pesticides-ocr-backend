import Joi from 'joi'
import Boom from '@hapi/boom'

import { config } from '#/config.js'
import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import { verifiedNonce } from '#/services/metrics/journey-token.js'
import {
  countRegistrations,
  countJourneyStarts,
  countJourneyNotEligible,
  recordJourneyStart,
  recordJourneyNotEligible
} from '#/services/metrics/metrics.js'

// Backend journey tracking for the digital completion metric (EQ-472). Volumes
// come from the database — the authoritative, consent-independent source (GA
// under-counts). The read endpoints are protected by the same Entra case-officer
// auth as the operators routes; the journey beacons are deliberately public
// (see below).

const auth = requireRole(...getCaseOfficerRoles())

const HTTP_NO_CONTENT = 204
// Beacons ignore the request body; cap it small so an unauthenticated caller
// can't stream a large payload at us.
const MAX_BEACON_PAYLOAD_BYTES = 1024
// The frontend sends its signed per-session token in this header.
const JOURNEY_TOKEN_HEADER = 'x-journey-token'

// Optional inclusive ISO date bounds. Unknown params and invalid dates are
// rejected with 400 by the server-wide failAction (same as the /operators route).
const querySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
})

// The read endpoints differ only in which count function they call, so build
// them from one shape rather than duplicating the options/handler.
const countRoute = (path, count) => ({
  method: 'GET',
  path,
  options: {
    auth,
    validate: {
      query: querySchema
    }
  },
  handler: async (request, h) => {
    const result = await count(request.db, {
      from: request.query.from,
      to: request.query.to
    })
    return h.response(result)
  }
})

// Public, unauthenticated beacon. The applicant journey has no bearer token, so
// these cannot be guarded like the read endpoints. The frontend fires them
// server-side, once per session, as the applicant moves through the journey; we
// record a single timestamp (no PII) so completion rate can be measured
// consent-free.
//
// Because they're public a script could otherwise hit them directly and inflate
// the counts. When `journeyToken.secret` is configured, each beacon must carry a
// valid signed per-session token (minted + signed by the frontend under the
// shared secret) — a direct/forged call is rejected (401), and the verified nonce
// is stored under a unique index so a replay is counted once. Verification is
// gated on the secret being set, so local/unconfigured tiers still accept
// unsigned beacons (see warnIfJourneyTokenUnset). The body is ignored (and not
// parsed) to keep the surface minimal.
const beaconRoute = (path, record, label) => ({
  method: 'POST',
  path,
  options: {
    payload: { parse: false, maxBytes: MAX_BEACON_PAYLOAD_BYTES }
  },
  handler: async (request, h) => {
    const secret = config.get('journeyToken.secret')
    let nonce
    if (secret) {
      nonce = verifiedNonce(request.headers[JOURNEY_TOKEN_HEADER], secret)
      if (!nonce) {
        throw Boom.unauthorized('Invalid or missing journey token')
      }
    }

    try {
      await record(request.db, nonce)
      return h.response().code(HTTP_NO_CONTENT)
    } catch (err) {
      request.log(['error'], err)
      throw Boom.internal(`Failed to record ${label}`)
    }
  }
})

// Fail-open guard: verification is gated on the secret being set (so local /
// onboarding tiers still work), but a deployed tier reaching here with no secret
// means the anti-spoofing control is silently off. Warn loudly at boot (mirrors
// the auth plugin's missing-config warning) rather than letting it pass unnoticed.
export function warnIfJourneyTokenUnset(server) {
  if (
    !config.get('journeyToken.secret') &&
    config.get('cdpEnvironment') !== 'local'
  ) {
    server.log(
      ['metrics', 'warn'],
      'journey token secret is not configured — journey beacons will accept unsigned requests'
    )
  }
}

export const metrics = [
  countRoute('/metrics/registrations', countRegistrations),
  countRoute('/metrics/journey-starts', countJourneyStarts),
  countRoute('/metrics/journey-not-eligible', countJourneyNotEligible),
  beaconRoute('/metrics/journey-starts', recordJourneyStart, 'journey start'),
  beaconRoute(
    '/metrics/journey-not-eligible',
    recordJourneyNotEligible,
    'not-eligible finish'
  )
]
