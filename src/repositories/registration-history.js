import Joi from 'joi'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { OCR_REGISTRATION_HISTORY_COLLECTION } from '#/common/constants/collections.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  MAX_BY_ID_LENGTH,
  MAX_REASON_LENGTH,
  MAX_REQUEST_ID_LENGTH
} from '#/common/constants/history.js'
import { assertLimit, assertReference } from '#/repositories/guards.js'

const actorSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(ACTOR_TYPE))
    .required(),
  id: Joi.string()
    .max(MAX_BY_ID_LENGTH)
    .when('type', { is: ACTOR_TYPE.CASE_OFFICER, then: Joi.required() })
}).required()
const reasonSchema = Joi.string().max(MAX_REASON_LENGTH)
const requestIdSchema = Joi.string().max(MAX_REQUEST_ID_LENGTH)

const auditSchema = Joi.object({
  by: actorSchema,
  reason: reasonSchema,
  requestId: requestIdSchema
}).required()

const entrySchema = Joi.object({
  reference: Joi.string().required(),
  version: Joi.number().integer().min(FIRST_VERSION).required(),
  operation: Joi.string()
    .valid(...Object.values(HISTORY_OPERATION))
    .required(),
  at: Joi.date().required(),
  by: actorSchema,
  reason: reasonSchema,
  requestId: requestIdSchema,
  // The snapshot must be of the same registration as the entry.
  snapshot: Joi.object({
    reference: Joi.string().valid(Joi.ref('...reference')).required()
  })
    .unknown()
    .required()
}).required()

const NO_ID = { _id: 0 }

export function assertAudit(audit) {
  const { error } = auditSchema.validate(audit, { convert: false })
  if (error) {
    throw new TypeError(`Invalid audit details: ${error.message}`)
  }
}

// Append-only: entries can be added and read, never changed or removed.
export function createRegistrationHistory({ db }) {
  const history = db.collection(OCR_REGISTRATION_HISTORY_COLLECTION)

  return {
    async append(entry, { session } = {}) {
      const { error, value } = entrySchema.validate(entry, { convert: false })
      if (error) {
        throw new TypeError(`Invalid history entry: ${error.message}`)
      }
      // insertOne adds _id to the object it's given, so give it a copy.
      await history.insertOne({ ...value }, { session })
      return value
    },

    async findVersion(reference, version, { session } = {}) {
      assertReference(reference)
      if (!Number.isInteger(version)) {
        throw new TypeError('version must be an integer')
      }
      return history.findOne(
        { reference, version },
        { projection: NO_ID, session }
      )
    },

    // Newest first, so a limit drops the oldest versions, not the latest.
    async list(reference, { limit, session } = {}) {
      assertReference(reference)
      assertLimit(limit)
      return history
        .find({ reference }, { projection: NO_ID, session })
        .sort({ version: -1 })
        .limit(limit)
        .toArray()
    }
  }
}
