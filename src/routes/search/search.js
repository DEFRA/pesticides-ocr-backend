import Boom from '@hapi/boom'
import {
  getOneByReferenceNumber,
  validateReferenceNumber
} from '#/services/search/search.js'

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
    }
  }
]
