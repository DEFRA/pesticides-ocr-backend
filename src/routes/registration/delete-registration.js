import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { MAX_REASON_LENGTH } from '#/common/constants/history.js'
import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'
import { failWithBadRequest } from '#/common/helpers/search-query.js'
import { VersionConflictError } from '#/repositories/version-conflict-error.js'
import { validateReferenceNumber } from '#/services/search/search.js'

const paramsSchema = Joi.object({
  reference: Joi.string()
    .max(MAX_REFERENCE_LENGTH)
    .custom((reference, helpers) =>
      validateReferenceNumber(reference)
        ? reference
        : helpers.message('Invalid reference number')
    )
    .required()
})

const payloadSchema = Joi.object({
  version: Joi.number().integer().min(0).strict().required(),
  reason: Joi.string().trim().max(MAX_REASON_LENGTH).allow('').optional()
}).required()

export const deleteRegistration = [
  {
    method: 'DELETE',
    path: '/registrations/{reference}',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      validate: {
        params: paramsSchema,
        payload: payloadSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { reference } = request.params
      const { version, reason } = request.payload
      const { subject } = request.auth.credentials

      let deleted
      try {
        deleted = await request.registrations.softDelete(reference, {
          by: { type: ACTOR_TYPE.CASE_OFFICER, id: subject },
          reason,
          expectedVersion: version
        })
      } catch (err) {
        if (err instanceof VersionConflictError) {
          throw Boom.conflict(
            'The registration has changed since it was loaded. Reload it and try again.'
          )
        }
        request.log(['error'], err)
        throw Boom.internal('Failed to delete registration')
      }

      // An already deleted registration is out of sight, like a missing one.
      if (!deleted) {
        throw Boom.notFound('Registration not found')
      }

      return h.response({
        reference,
        version: deleted.version,
        deletedAt: deleted.deletedAt
      })
    }
  }
]
