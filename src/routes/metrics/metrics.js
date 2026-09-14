import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  countRegistrations,
  countJourneyStarts,
  recordJourneyStart
} from '#/services/metrics/metrics.js'

// Case-officer performance metrics (EQ-283). Volumes come from the database —
// the authoritative, consent-independent source (GA under-counts) — and the
// read endpoints are protected by the same Entra case-officer auth as the
// operators routes. The journey-start beacon is deliberately public (see below).

const auth = requireRole(...getCaseOfficerRoles())

const HTTP_NO_CONTENT = 204

// Optional inclusive ISO date bounds. Unknown params and invalid dates are
// rejected with 400 by the server-wide failAction (same as the /operators route).
const querySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
})

// The two read endpoints differ only in which count function they call, so build
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

export const metrics = [
  countRoute('/metrics/registrations', countRegistrations),
  countRoute('/metrics/journey-starts', countJourneyStarts),
  {
    // Public, unauthenticated beacon. The applicant journey has no bearer token,
    // so this cannot be guarded like the read endpoints. The frontend fires it
    // server-side, once per session, at the first journey page; we record a
    // single timestamp (no PII) so completion rate can be measured consent-free
    // (starts vs finishes).
    //
    // POC LIMITATION: unlike POST /register (which requires a full Joi payload +
    // unique reference), this write is trivial and unauthenticated, so a script
    // could inflate the "starts" count and skew completion rate. Acceptable for
    // the POC because the backend is not browser-facing (the frontend calls it
    // server-to-server). Before this KPI is relied on in production, add a
    // server-side control here — e.g. IP/origin rate limiting or a per-session
    // nonce minted by the frontend. The body is ignored (and not parsed) to keep
    // the surface minimal.
    method: 'POST',
    path: '/metrics/journey-starts',
    options: {
      payload: { parse: false, maxBytes: 1024 }
    },
    handler: async (request, h) => {
      try {
        await recordJourneyStart(request.db)
        return h.response().code(HTTP_NO_CONTENT)
      } catch (err) {
        request.log(['error'], err)
        throw Boom.internal('Failed to record journey start')
      }
    }
  }
]
