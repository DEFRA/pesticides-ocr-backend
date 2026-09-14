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

export const metrics = [
  {
    method: 'GET',
    path: '/metrics/registrations',
    options: {
      auth,
      validate: {
        query: querySchema
      }
    },
    handler: async (request, h) => {
      const result = await countRegistrations(request.db, {
        from: request.query.from,
        to: request.query.to
      })
      return h.response(result)
    }
  },
  {
    // Public, unauthenticated beacon. The applicant journey has no bearer token,
    // so this cannot be guarded like the read endpoints — it is the same trust
    // model as the public POST /register. The frontend fires it once per session
    // at the first journey page; we record a single timestamp (no PII) so
    // completion rate can be measured consent-free (starts vs finishes).
    method: 'POST',
    path: '/metrics/journey-starts',
    handler: async (request, h) => {
      try {
        await recordJourneyStart(request.db)
        return h.response().code(HTTP_NO_CONTENT)
      } catch (err) {
        request.log(['error'], err)
        throw Boom.internal('Failed to record journey start')
      }
    }
  },
  {
    method: 'GET',
    path: '/metrics/journey-starts',
    options: {
      auth,
      validate: {
        query: querySchema
      }
    },
    handler: async (request, h) => {
      const result = await countJourneyStarts(request.db, {
        from: request.query.from,
        to: request.query.to
      })
      return h.response(result)
    }
  }
]
