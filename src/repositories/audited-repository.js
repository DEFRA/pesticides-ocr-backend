import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import { FIRST_VERSION, HISTORY_OPERATION } from '#/common/constants/history.js'
import { LIFECYCLE_FIELDS } from '#/common/constants/registration.js'
import {
  assertLimit,
  assertObject,
  assertReference
} from '#/repositories/guards.js'
import { withTransaction } from '#/repositories/mongo-transaction.js'
import {
  assertAudit,
  createRegistrationHistory
} from '#/repositories/registration-history.js'

const PROTECTED_FIELDS = new Set([
  '_id',
  'reference',
  'submittedAt',
  'version',
  ...LIFECYCLE_FIELDS
])

// Registrations stored before soft delete have no isDeleted field, so they
// count as not deleted.
const NOT_DELETED = { isDeleted: { $ne: true } }
const NO_ID = { _id: 0 }

const visible = (filter, includeDeleted) =>
  includeDeleted === true ? filter : { $and: [filter, NOT_DELETED] }

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

const historyEntry = (operation, snapshot, { by, reason, requestId, at }) => ({
  reference: snapshot.reference,
  version: snapshot.version,
  operation,
  at,
  by,
  ...(reason === undefined ? {} : { reason }),
  ...(requestId === undefined ? {} : { requestId }),
  snapshot
})

function auditDetails({ by, reason, requestId }) {
  const details = {
    by,
    reason: reason ?? undefined,
    requestId: requestId ?? undefined
  }
  assertAudit(details)
  return { ...details, at: new Date() }
}

export function createAuditedRepository({ client, db }) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)
  const history = createRegistrationHistory({ db })

  // A session outside a transaction would let the registration change commit
  // without its history entry.
  const runInTransaction = (session, work) => {
    if (!session) {
      return withTransaction(client, work)
    }
    if (!session.inTransaction()) {
      throw new TypeError('session must be in a transaction')
    }
    return work(session)
  }

  return {
    async create(registration, options) {
      const { by, reason, requestId, session } = options ?? {}
      assertObject(registration, 'registration')
      assertReference(registration.reference)
      assertNoProtectedFields(registration, ['reference', 'submittedAt'])
      const audit = auditDetails({ by, reason, requestId })
      const document = {
        ...registration,
        isDeleted: false,
        version: FIRST_VERSION
      }
      await runInTransaction(session, async (txSession) => {
        // insertOne adds _id to the object it's given, so give it a copy.
        await registrations.insertOne({ ...document }, { session: txSession })
        await history.append(
          historyEntry(HISTORY_OPERATION.CREATE, document, audit),
          { session: txSession }
        )
      })
      return document
    },

    async findByReference(reference, options) {
      const { includeDeleted = false, session } = options ?? {}
      assertReference(reference)
      return registrations.findOne(visible({ reference }, includeDeleted), {
        projection: NO_ID,
        session
      })
    },

    async search(filter = {}, options) {
      const {
        includeDeleted = false,
        sort = {},
        skip = 0,
        limit,
        session
      } = options ?? {}
      assertObject(filter, 'filter')
      assertLimit(limit)
      return registrations
        .find(visible(filter, includeDeleted), { projection: NO_ID, session })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray()
    },

    // null when there's no such registration, or it's deleted.
    async update(reference, changes, options) {
      const { by, reason, requestId, session } = options ?? {}
      assertReference(reference)
      assertObject(changes, 'changes')
      if (!Object.keys(changes).length) {
        throw new TypeError('changes must not be empty')
      }
      assertNoProtectedFields(changes)
      const audit = auditDetails({ by, reason, requestId })
      return runInTransaction(session, async (txSession) => {
        const updated = await registrations.findOneAndUpdate(
          visible({ reference }, false),
          { $set: changes, $inc: { version: 1 } },
          { returnDocument: 'after', projection: NO_ID, session: txSession }
        )
        if (updated) {
          await history.append(
            historyEntry(HISTORY_OPERATION.UPDATE, updated, audit),
            { session: txSession }
          )
        }
        return updated
      })
    },

    // null when there's no such registration, or it's already deleted.
    async softDelete(reference, options) {
      const { by, reason, requestId, session } = options ?? {}
      assertReference(reference)
      const audit = auditDetails({ by, reason, requestId })
      return runInTransaction(session, async (txSession) => {
        const deleted = await registrations.findOneAndUpdate(
          visible({ reference }, false),
          {
            $set: {
              isDeleted: true,
              deletedAt: audit.at,
              deletedBy: audit.by,
              deletionReason: audit.reason
            },
            $inc: { version: 1 }
          },
          { returnDocument: 'after', projection: NO_ID, session: txSession }
        )
        if (deleted) {
          await history.append(
            historyEntry(HISTORY_OPERATION.DELETE, deleted, audit),
            { session: txSession }
          )
        }
        return deleted
      })
    },

    withTransaction(work) {
      return withTransaction(client, work)
    }
  }
}
