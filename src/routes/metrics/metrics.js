import Joi from 'joi'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import { countRegistrations } from '#/services/metrics/metrics.js'

// Case-officer performance metrics (EQ-283). Registration volume from the
// database — the authoritative, consent-independent source (GA under-counts) —
// protected by the same Entra case-officer auth as the operators routes.

const auth = requireRole(...getCaseOfficerRoles())

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
  }
]
