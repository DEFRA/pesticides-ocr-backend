import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchQuerySchema,
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { resolveQuery } from '#/services/search/search.js'

// GET /search (EQ-366) — the register's single read endpoint. A reference gives
// the exact record; a free-text term (?q=, blank = everything) gives the matches,
// newest first; neither or both is a 400. This absorbed the former /operators
// dashboard read, which asked the same question under a different name.
//
// Now behind the case-officer bearer auth: it returns whole registrations, so
// it should never have been open.
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
    }
  }
]
