import Boom from '@hapi/boom'
import Joi from 'joi'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  getOneByReferenceNumber,
  validateReferenceNumber
} from '#/services/search/search.js'

export const search = [
  {
    method: 'GET',
    path: '/search',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      cache: noStoreCache,
      validate: {
        query: searchQuerySchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const result = await resolveQuery(request.db, request.query)

      if (result.invalidReference) {
        return Boom.badRequest('Invalid reference number')
      }

      if (result.list) {
        return h.response(result.list)
      }

      if (!result.single) {
        return Boom.notFound(
          'No records found for the reference number provided'
        )
      }

      return h.response(result.single)
    },
    options: {
      validate: {
        query: Joi.object({
          reference: Joi.string().trim().max(100).required().messages({
            'string.max': 'Reference number must be 100 characters or less',
            'string.empty': 'Reference number is required',
            // A missing reference is as invalid as a malformed one; keep the
            // message identical to the handler's so callers see one contract.
            'any.required': 'Invalid reference number'
          })
        }),
        // Unknown query parameters are dropped rather than rejected, so a
        // caller appending e.g. a cache-buster still gets its record back.
        options: { stripUnknown: true }
      }
      // TODO: re-enable auth one e2e is ready
      // auth: requireRole(...roleValues)
    }
  }
]
