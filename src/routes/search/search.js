import { config } from '#/config.js'
import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchQuerySchema,
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { searchRegistrations } from '#/services/search/search.js'

export const search = [
  {
    method: 'GET',
    path: '/search',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      cache: noStoreCache,
      validate: {
        query: searchQuerySchema(config.get('search.maxPageSize')),
        options: { abortEarly: false },
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { page, pageSize, ...criteria } = request.query

      return h.response(
        await searchRegistrations(request.db, criteria, { page, pageSize })
      )
    }
  }
]
