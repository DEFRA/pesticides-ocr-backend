import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  FIRST_VERSION,
  MAX_HISTORY_PAGE_SIZE
} from '#/common/constants/history.js'
import { registrationParamsSchema } from '#/common/helpers/registration-reference.js'
import {
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { getRegistrationHistory } from '#/services/registration/history.js'

const DEFAULT_PAGE_SIZE = 50

const querySchema = Joi.object({
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(MAX_HISTORY_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .messages({
      'number.base': 'pageSize must be an integer',
      'number.integer': 'pageSize must be an integer',
      'number.min': 'pageSize must be at least 1',
      'number.max': `pageSize must be at most ${MAX_HISTORY_PAGE_SIZE}`,
      'number.unsafe': 'pageSize must be a safe integer'
    }),
  beforeVersion: Joi.number()
    .integer()
    .min(FIRST_VERSION)
    .max(Number.MAX_SAFE_INTEGER)
    .messages({
      'number.base': 'beforeVersion must be an integer',
      'number.integer': 'beforeVersion must be an integer',
      'number.min': 'beforeVersion must be a positive integer',
      'number.max': 'beforeVersion must be a safe integer',
      'number.unsafe': 'beforeVersion must be a safe integer'
    })
}).unknown(false)

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
