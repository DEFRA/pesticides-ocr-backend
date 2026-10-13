import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import { LIFECYCLE_FIELDS } from '#/common/constants/registration.js'
import { withTransaction } from '#/repositories/mongo-transaction.js'

const PROTECTED_FIELDS = new Set([
  '_id',
  'reference',
  'submittedAt',
  ...LIFECYCLE_FIELDS
])

// Registrations stored before soft delete have no isDeleted field, so they
// count as not deleted.
const NOT_DELETED = { isDeleted: { $ne: true } }
const NO_ID = { _id: 0 }

const visible = (filter, includeDeleted) =>
  includeDeleted === true ? filter : { $and: [filter, NOT_DELETED] }

// A non-string reference could be a query operator, like { $ne: '' }, that
// matches someone else's registration.
function assertReference(reference) {
  if (typeof reference !== 'string') {
    throw new TypeError('reference must be a string')
  }
}

// A dotted path, like 'deletedBy.type', would set part of a protected field.
function assertNoProtectedFields(fields, allowed = []) {
  const rejected = Object.keys(fields).filter((field) => {
    const topLevel = field.split('.')[0]
    return PROTECTED_FIELDS.has(topLevel) && !allowed.includes(topLevel)
  })
  if (rejected.length) {
    throw new Error(`Cannot set protected fields: ${rejected.join(', ')}`)
  }
}

export function createAuditedRepository({ client, db }) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)

  return {
    async create(registration, { session } = {}) {
      assertReference(registration.reference)
      assertNoProtectedFields(registration, ['reference', 'submittedAt'])
      const document = { ...registration, isDeleted: false }
      // insertOne adds _id to the object it's given, so give it a copy.
      await registrations.insertOne({ ...document }, { session })
      return document
    },

    async findByReference(reference, { includeDeleted = false, session } = {}) {
      assertReference(reference)
      return registrations.findOne(visible({ reference }, includeDeleted), {
        projection: NO_ID,
        session
      })
    },

    // limit is required: Mongo treats a missing or 0 limit as no limit at all.
    async search(
      filter = {},
      { includeDeleted = false, sort = {}, skip = 0, limit, session } = {}
    ) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new TypeError('limit must be a positive integer')
      }
      return registrations
        .find(visible(filter, includeDeleted), { projection: NO_ID, session })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray()
    },

    // null when there's no such registration, or it's deleted.
    async update(reference, changes, { session } = {}) {
      assertReference(reference)
      assertNoProtectedFields(changes)
      return registrations.findOneAndUpdate(
        visible({ reference }, false),
        { $set: changes },
        { returnDocument: 'after', projection: NO_ID, session }
      )
    },

    // null when there's no such registration, or it's already deleted.
    async softDelete(reference, { deletedBy, reason, session } = {}) {
      assertReference(reference)
      if (!deletedBy) {
        throw new TypeError('deletedBy is required')
      }
      return registrations.findOneAndUpdate(
        visible({ reference }, false),
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy,
            deletionReason: reason
          }
        },
        { returnDocument: 'after', projection: NO_ID, session }
      )
    },

    withTransaction(work) {
      return withTransaction(client, work)
    }
  }
}
