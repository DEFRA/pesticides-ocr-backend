import Boom from '@hapi/boom'
import { findAllExampleData, findExampleData } from '#/services/ExampleFind.js'

export const example = [
  {
    method: 'GET',
    path: '/example',
    handler: async (request, h) => {
      const entities = await findAllExampleData(request.db)
      return h.response(entities)
    }
  },
  {
    method: 'GET',
    path: '/example/{exampleId}',
    handler: async (request, h) => {
      const entity = await findExampleData(request.db, request.params.exampleId)

      if (!entity) {
        return Boom.notFound()
      }

      return h.response(entity)
    }
  }
]
