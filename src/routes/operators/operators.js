import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchOperators,
  getOperatorByReference
} from '#/services/operators/operators.js'

// Case-officer dashboard API (EQ-385). Serves registered operators to the admin
// UI (EQ-227), protected by the EQ-413 auth foundation: a valid Entra bearer
// token with the case-officer role. Responses match the frontend Operator
// contract so the UI's data stub becomes a thin adapter.

const roleValues = getCaseOfficerRoles()

// A search term is optional, trimmed, and length-bounded so a caller can't push
// an oversized string into the query.
const MAX_SEARCH_LENGTH = 100

// Bound the path reference before it reaches the DB query (consistent with the
// /search route). Comfortably longer than a PPP-XXX-XXX reference. Lookup is
// deliberately format-agnostic — unlike /search we don't enforce the reference
// pattern, so a malformed value simply misses and returns 404 rather than 400.
const MAX_REFERENCE_LENGTH = 32

const failWithBadRequest = (_request, _h, err) => {
  throw Boom.badRequest(err.message)
}

const searchQuerySchema = Joi.object({
  search: Joi.string().trim().max(MAX_SEARCH_LENGTH).allow('').optional()
})

const referenceParamsSchema = Joi.object({
  reference: Joi.string().trim().max(MAX_REFERENCE_LENGTH).required()
})

export const operators = [
  {
    method: 'GET',
    path: '/operators',
    options: {
      auth: requireRole(...roleValues),
      validate: {
        query: searchQuerySchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const results = await searchOperators(request.db, {
        query: request.query.search
      })
      return h.response(results)
    }
  },
  {
    method: 'GET',
    path: '/operators/{reference}',
    options: {
      auth: requireRole(...roleValues),
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
