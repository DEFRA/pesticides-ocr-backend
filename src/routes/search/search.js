import Boom from '@hapi/boom'
import Joi from 'joi'
import {
  getOneByReferenceNumber,
  validateReferenceNumber
} from '#/services/search/search.js'

// TODO: re-enable auth one e2e is ready
// import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
// const roleValues = getCaseOfficerRoles()

export const search = [
  {
    method: 'GET',
    path: '/search',
    handler: async (request, h) => {
      const { reference } = request.query

      if (!validateReferenceNumber(reference)) {
        return Boom.badRequest('Invalid reference number')
      }

      const entity = await getOneByReferenceNumber(request.db, reference)

      if (!entity) {
        return Boom.notFound(
          'No records found for the reference number provided'
        )
      }

      return h.response(entity)
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
