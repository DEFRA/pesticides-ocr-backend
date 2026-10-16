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

// A session outside a transaction would let the registration change commit
// without its history entry. If the work fails, the caller's transaction is
// aborted as well, so catching the error can't commit the change on its own.
async function runInTransaction(client, session, work) {
  if (!session) {
    return withTransaction(client, work)
  }
  if (!session.inTransaction()) {
    throw new TypeError('session must be in a transaction')
  }
  try {
    return await work(session)
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction()
    }
    throw error
  }
}

// change returns the registration after the change, or null when there was
// nothing to change, in which case no history entry is written.
function recordChange(
  { client, history },
  { session, operation, audit, change }
) {
  return runInTransaction(client, session, async (txSession) => {
    const changed = await change(txSession)
    if (changed) {
      await history.append(historyEntry(operation, changed, audit), {
        session: txSession
      })
    }
    return changed
  })
}

function readOperations(registrations) {
  return {
    async findByReference(reference, options) {
      const { includeDeleted = false, session } = options ?? {}
      assertReference(reference)
      return registrations.findOne(visible({ reference }, includeDeleted), {
        projection: NO_ID,
        session
      })
    },

    async search(filter, options) {
      const criteria = filter === undefined ? {} : filter
      const {
        includeDeleted = false,
        sort = {},
        skip = 0,
        limit,
        session
      } = options ?? {}
      assertObject(criteria, 'filter')
      assertLimit(limit)
      return registrations
        .find(visible(criteria, includeDeleted), { projection: NO_ID, session })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray()
    }
  }
}

function writeOperations(context) {
  const { registrations } = context
  const changeExisting = (reference, update, txSession) =>
    registrations.findOneAndUpdate(
      visible({ reference }, false),
      { ...update, $inc: { version: 1 } },
      { returnDocument: 'after', projection: NO_ID, session: txSession }
    )

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
      await recordChange(context, {
        session,
        operation: HISTORY_OPERATION.CREATE,
        audit,
        change: async (txSession) => {
          // insertOne adds _id to the object it's given, so give it a copy.
          await registrations.insertOne({ ...document }, { session: txSession })
          return document
        }
      })
      return document
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
      return recordChange(context, {
        session,
        operation: HISTORY_OPERATION.UPDATE,
        audit,
        change: (txSession) =>
          changeExisting(reference, { $set: changes }, txSession)
      })
    },

    // null when there's no such registration, or it's already deleted.
    async softDelete(reference, options) {
      const { by, reason, requestId, session } = options ?? {}
      assertReference(reference)
      const audit = auditDetails({ by, reason, requestId })
      const deletion = {
        isDeleted: true,
        deletedAt: audit.at,
        deletedBy: audit.by,
        deletionReason: audit.reason
      }
      return recordChange(context, {
        session,
        operation: HISTORY_OPERATION.DELETE,
        audit,
        change: (txSession) =>
          changeExisting(reference, { $set: deletion }, txSession)
      })
    }
  }
}

export function createAuditedRepository({ client, db }) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)
  const history = createRegistrationHistory({ db })

  return {
    ...readOperations(registrations),
    ...writeOperations({ client, registrations, history }),

    withTransaction(work) {
      return withTransaction(client, work)
    }
  }
}
