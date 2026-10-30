import Joi from 'joi'
import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { VERSION_CONFLICT } from '#/common/constants/error-codes.js'
import { MAX_REASON_LENGTH } from '#/common/constants/history.js'
import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { requestIdFromTrace } from '#/common/helpers/request-id.js'
import {
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { VersionConflictError } from '#/repositories/version-conflict-error.js'
import { validateReferenceNumber } from '#/services/search/search.js'

// A 500-character reason is at most 2000 bytes in UTF-8, plus the version.
const MAX_PAYLOAD_BYTES = 2048

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
  reason: Joi.string().trim().min(1).max(MAX_REASON_LENGTH).required()
}).required()

export const deleteRegistration = [
  {
    method: 'DELETE',
    path: '/registrations/{reference}',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      cache: noStoreCache,
      payload: { maxBytes: MAX_PAYLOAD_BYTES, allow: 'application/json' },
      validate: {
        params: paramsSchema,
        payload: payloadSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { reference } = request.params
      const { version, reason } = request.payload
      const { subject, roles } = request.auth.credentials
      // The history must say which case officer deleted it.
      if (!subject) {
        throw Boom.forbidden('The token has no subject')
      }

      let deleted
      try {
        deleted = await request.registrations.softDelete(reference, {
          by: { type: ACTOR_TYPE.CASE_OFFICER, id: subject },
          reason,
          requestId: requestIdFromTrace(),
          expectedVersion: version
        })
      } catch (err) {
        if (err instanceof VersionConflictError) {
          throw withErrorCode(
            Boom.conflict(
              'The registration has changed since it was loaded. Reload it and try again.'
            ),
            VERSION_CONFLICT
          )
        }
        request.log(['error'], err)
        throw Boom.internal('Failed to delete registration')
      }

      // An already deleted registration is out of sight, like a missing one.
      if (!deleted) {
        throw Boom.notFound('Registration not found')
      }

      // The reason isn't logged: it's free text and may name someone.
      request.log(
        ['registration', 'audit'],
        `registration deleted: reference=${reference} version=${deleted.version} subject=${subject} roles=${roles}`
      )

      return h.response({
        reference,
        version: deleted.version,
        deletedAt: deleted.deletedAt
      })
    }
  }
]
