import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchQuerySchema,
  failWithBadRequest
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

      // Responses carry whole registrations, so keep them out of any shared
      // cache, matching /export.
      const noStore = (response) => response.header('cache-control', 'no-store')

      if (result.list) {
        return noStore(h.response(result.list))
      }

      if (!result.single) {
        return Boom.notFound(
          'No records found for the reference number provided'
        )
      }

      return noStore(h.response(result.single))
    }
  }
]
