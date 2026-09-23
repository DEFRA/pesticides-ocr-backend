import { searchOperators } from '#/services/operators/operators.js'
import { searchRouteOptions } from './helpers/route-options.js'

// GET /operators — the case-officer dashboard grid (EQ-385): list/search
// registered operators for the admin UI (EQ-227). Responses match the frontend
// Operator contract so the UI's data stub becomes a thin adapter.
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
  }
]
