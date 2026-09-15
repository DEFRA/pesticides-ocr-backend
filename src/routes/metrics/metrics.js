import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
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
// POC LIMITATION: unlike POST /register (a full Joi payload + unique reference),
// these writes are trivial and unauthenticated, so a script could inflate the
// counts and skew the metric. Acceptable for the POC because the backend is not
// browser-facing (the frontend calls it server-to-server). Before this KPI is
// relied on in production, add a server-side control here — e.g. IP/origin rate
// limiting or a signed per-session token minted by the frontend. The body is
// ignored (and not parsed) to keep the surface minimal.
const beaconRoute = (path, record, label) => ({
  method: 'POST',
  path,
  options: {
    payload: { parse: false, maxBytes: MAX_BEACON_PAYLOAD_BYTES }
  },
  handler: async (request, h) => {
    try {
      await record(request.db)
      return h.response().code(HTTP_NO_CONTENT)
    } catch (err) {
      request.log(['error'], err)
      throw Boom.internal(`Failed to record ${label}`)
    }
  }
})

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
