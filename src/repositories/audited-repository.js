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

const given = (value) => value !== undefined && value !== null && value !== ''

function auditDetails({ by, reason, requestId }) {
  const details = {
    by,
    ...(given(reason) && { reason }),
    ...(given(requestId) && { requestId })
  }
  assertAudit(details)
  return details
}

const historyEntry = (operation, snapshot, audit, at) => ({
  reference: snapshot.reference,
  version: snapshot.version,
  operation,
  at,
  ...audit,
  snapshot
})

// A failure in a caller's transaction is rethrown when its work finishes, so
// the whole transaction rolls back even if the caller caught the failure.
function transactionRunner(client) {
  const failures = new WeakMap()

  return {
    async run(session, work) {
      if (!session) {
        return withTransaction(client, work)
      }
      if (!failures.has(session)) {
        throw new TypeError('session must come from withTransaction')
      }
      // After a failure the transaction is already lost, so later changes fail
      // with the same error instead of a misleading "no such transaction".
      const earlier = failures.get(session)
      if (earlier) {
        throw earlier
      }
      try {
        return await work(session)
      } catch (error) {
        if (failures.get(session) === null) {
          failures.set(session, error)
        }
        throw error
      }
    },

    withTransaction(work) {
      return withTransaction(client, async (session) => {
        failures.set(session, null)
        try {
          const result = await work(session)
          const failure = failures.get(session)
          if (failure) {
            throw failure
          }
          return result
        } catch (error) {
          // A transient failure keeps its label, so the driver retries it even
          // if the caller wrapped it in its own error.
          const failure = failures.get(session)
          throw failure?.hasErrorLabel?.('TransientTransactionError')
            ? failure
            : error
        } finally {
          failures.delete(session)
        }
      })
    }
  }
}

// prepare checks the input inside the transaction, so a caught check failure
// rolls it back too. change returns the registration after the change, or null
// when there was nothing to change.
function recordChange(
  { run, history },
  { session, operation, prepare, change }
) {
  return run(session, async (txSession) => {
    const { audit, ...input } = prepare()
    const at = new Date()
    const changed = await change(txSession, { ...input, audit, at })
    if (changed) {
      await history.append(historyEntry(operation, changed, audit, at), {
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

    async search(filter = {}, options = {}) {
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
    }
  }
}

function prepareCreate(registration, auditInput) {
  assertObject(registration, 'registration')
  assertReference(registration.reference)
  assertNoProtectedFields(registration, ['reference', 'submittedAt'])
  return {
    audit: auditDetails(auditInput),
    document: { ...registration, isDeleted: false, version: FIRST_VERSION }
  }
}

function prepareUpdate(reference, changes, auditInput) {
  assertReference(reference)
  assertObject(changes, 'changes')
  if (!Object.keys(changes).length) {
    throw new TypeError('changes must not be empty')
  }
  assertNoProtectedFields(changes)
  return { audit: auditDetails(auditInput) }
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
      return recordChange(context, {
        session,
        operation: HISTORY_OPERATION.CREATE,
        prepare: () => prepareCreate(registration, { by, reason, requestId }),
        change: async (txSession, { document }) => {
          // insertOne adds _id to the object it's given, so give it a copy.
          await registrations.insertOne({ ...document }, { session: txSession })
          return document
        }
      })
    },

    // null when there's no such registration, or it's deleted.
    async update(reference, changes, options) {
      const { by, reason, requestId, session } = options ?? {}
      return recordChange(context, {
        session,
        operation: HISTORY_OPERATION.UPDATE,
        prepare: () =>
          prepareUpdate(reference, changes, { by, reason, requestId }),
        change: (txSession) =>
          changeExisting(reference, { $set: changes }, txSession)
      })
    },

    // null when there's no such registration, or it's already deleted.
    async softDelete(reference, options) {
      const { by, reason, requestId, session } = options ?? {}
      return recordChange(context, {
        session,
        operation: HISTORY_OPERATION.DELETE,
        prepare: () => {
          assertReference(reference)
          return { audit: auditDetails({ by, reason, requestId }) }
        },
        change: (txSession, { audit, at }) =>
          changeExisting(
            reference,
            {
              $set: {
                isDeleted: true,
                deletedAt: at,
                deletedBy: audit.by,
                deletionReason: audit.reason
              }
            },
            txSession
          )
      })
    }
  }
}

export function createAuditedRepository({ client, db }) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)
  const history = createRegistrationHistory({ db })
  const transactions = transactionRunner(client)

  return {
    ...readOperations(registrations),
    ...writeOperations({ run: transactions.run, registrations, history }),
    withTransaction: transactions.withTransaction
  }
}
