import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'

// Shared route options for the case-officer dashboard API (EQ-385). Every
// /operators* route requires a valid Entra bearer token with the case-officer
// role (the EQ-413 auth foundation); the list and export routes also share the
// same search-query validation.

export const auth = requireRole(...getCaseOfficerRoles())

// A search term is optional, trimmed, and length-bounded so a caller can't push
// an oversized string into the query.
const MAX_SEARCH_LENGTH = 100

// Validation failures surface as a clean 400 rather than the raw Joi error.
export const failWithBadRequest = (_request, _h, err) => {
  throw Boom.badRequest(err.message)
}

const searchQuerySchema = Joi.object({
  search: Joi.string().trim().max(MAX_SEARCH_LENGTH).allow('').optional()
})

// The list and export routes share the same auth + search-query validation.
export const searchRouteOptions = {
  auth,
  validate: {
    query: searchQuerySchema,
    failAction: failWithBadRequest
  }
}
