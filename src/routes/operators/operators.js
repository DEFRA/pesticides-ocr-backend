import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchOperators,
  getOperatorByReference
} from '#/services/operators/operators.js'
import { toCsv } from '#/services/operators/operators-export.js'

// Case-officer dashboard API (EQ-385). Serves registered operators to the admin
// UI (EQ-227), protected by the EQ-413 auth foundation: a valid Entra bearer
// token with the case-officer role. Responses match the frontend Operator
// contract so the UI's data stub becomes a thin adapter.

const auth = requireRole(...getCaseOfficerRoles())

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

// The list and export routes share the same auth + search-query validation.
const searchRouteOptions = {
  auth,
  validate: {
    query: searchQuerySchema,
    failAction: failWithBadRequest
  }
}

export const operators = [
  {
    method: 'GET',
    path: '/operators',
    options: searchRouteOptions,
    handler: async (request, h) => {
      const results = await searchOperators(request.db, {
        query: request.query.search
      })
      return h.response(results)
    }
  },
  {
    // Export the (filtered) operators as CSV for download (EQ-369). Same search +
    // auth as the list route. A static path, so Hapi matches it ahead of
    // /operators/{reference} regardless of declaration order. Unlike the paged
    // grid the export returns the full matching set (limit: 0); an empty result
    // yields the header row only.
    method: 'GET',
    path: '/operators/export',
    options: searchRouteOptions,
    handler: async (request, h) => {
      const results = await searchOperators(request.db, {
        query: request.query.search,
        limit: 0
      })
      // Audit the bulk PII download without logging the data itself: who, how
      // many rows, and whether a filter was applied (not the term — it may be a name).
      const { subject, roles } = request.auth.credentials
      request.log(
        ['operators', 'export', 'audit'],
        `operators export: subject=${subject} roles=${roles} rows=${results.length} filtered=${Boolean(request.query.search)}`
      )
      return h
        .response(toCsv(results))
        .type('text/csv; charset=utf-8')
        .header(
          'content-disposition',
          'attachment; filename="ocr-registrations.csv"'
        )
        .header('cache-control', 'no-store')
    }
  },
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
