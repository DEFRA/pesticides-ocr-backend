import Joi from 'joi'
import Boom from '@hapi/boom'

import { getOperatorByReference } from '#/services/operators/reference/reference.js'
import { auth, failWithBadRequest } from './helpers/route-options.js'

// GET /operators/{reference} — one operator by registration reference (EQ-385).

// Bound the path reference before it reaches the DB query (consistent with the
// /search route). Comfortably longer than a PPP-XXX-XXX reference. Lookup is
// deliberately format-agnostic — unlike /search we don't enforce the reference
// pattern, so a malformed value simply misses and returns 404 rather than 400.
const MAX_REFERENCE_LENGTH = 32

const referenceParamsSchema = Joi.object({
  reference: Joi.string().trim().max(MAX_REFERENCE_LENGTH).required()
})

export const operatorsReference = [
  {
    method: 'GET',
    path: '/operators/{reference}',
    options: {
      auth,
      validate: {
        params: referenceParamsSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const operator = await getOperatorByReference(
        request.db,
        request.params.reference
      )
      if (!operator) {
        return Boom.notFound(
          'No operator found for the reference number provided'
        )
      }
      return h.response(operator)
    }
  }
]
