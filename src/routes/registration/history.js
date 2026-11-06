import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import { FIRST_VERSION } from '#/common/constants/history.js'
import { registrationParamsSchema } from '#/common/helpers/registration-reference.js'
import {
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { getRegistrationHistory } from '#/services/registration/history.js'

const querySchema = Joi.object({
  pageSize: Joi.number().integer().min(1).max(100).default(50),
  beforeVersion: Joi.number()
    .integer()
    .min(FIRST_VERSION)
    .max(Number.MAX_SAFE_INTEGER)
})

export const registrationHistory = [
  {
    method: 'GET',
    path: '/registrations/{reference}/history',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      cache: noStoreCache,
      validate: {
        params: registrationParamsSchema,
        query: querySchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      let result
      try {
        result = await getRegistrationHistory(
          request.registrations,
          request.params.reference,
          request.query
        )
      } catch (err) {
        request.log(['error'], err)
        throw Boom.internal('Failed to retrieve registration history')
      }
      if (!result) {
        throw Boom.notFound('Registration history not found')
      }
      return h.response(result)
    }
  }
]
