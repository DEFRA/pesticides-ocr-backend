import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'
import { FIRST_VERSION, HISTORY_OPERATION } from '#/common/constants/history.js'
import {
  LIFECYCLE_FIELDS,
  SUBMITTED_AT
} from '#/common/constants/registration.js'
import {
  monthlyCountsPipeline,
  toMonthlyCounts
} from '#/common/helpers/monthly-counts.js'
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
  SUBMITTED_AT,
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
  // The sessions this repository's withTransaction started, each with its
  // first failure, if any.
  const transactions = new WeakMap()

  return {
    async run(session, work) {
      if (!session) {
        return withTransaction(client, work)
      }
      const transaction = transactions.get(session)
      if (!transaction) {
        throw new TypeError('session must come from withTransaction')
      }
      // After a failure the transaction is already lost, so later changes fail
      // with the same error instead of a misleading "no such transaction".
      if (transaction.failure) {
        throw transaction.failure
      }
      try {
        // The caller may have committed or aborted it already, and a change
        // made outside the transaction could be saved without its history.
        if (!session.inTransaction()) {
          throw new TypeError('session must have an active transaction')
        }
        return await work(session)
      } catch (error) {
        transaction.failure ??= error
        throw error
      }
    },

    withTransaction(work) {
      return withTransaction(client, async (session) => {
        const transaction = { failure: null }
        transactions.set(session, transaction)
        try {
          const result = await work(session)
          if (transaction.failure) {
            throw transaction.failure
          }
          return result
        } catch (error) {
          // A transient failure keeps its label, so the driver retries it even
          // if the caller wrapped it in its own error.
          const { failure } = transaction
          throw failure?.hasErrorLabel?.('TransientTransactionError')
            ? failure
            : error
        } finally {
          transactions.delete(session)
        }
      })
    }
  }
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
        projection = {},
        sort = {},
        skip = 0,
        limit,
        session
      } = options ?? {}
      assertObject(filter, 'filter')
      assertObject(projection, 'projection')
      assertLimit(limit)
      return registrations
        .find(visible(filter, includeDeleted), {
          projection: { ...projection, ...NO_ID },
          session
        })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray()
    },

    async count(filter = {}, options = {}) {
      const { includeDeleted = false, session } = options ?? {}
      assertObject(filter, 'filter')
      return registrations.countDocuments(visible(filter, includeDeleted), {
        session
      })
    },

    async countByMonth(options) {
      const { dateField, from, to, includeDeleted = false } = options ?? {}
      const pipeline = monthlyCountsPipeline({ dateField, from, to })
      const [result] = await registrations
        .aggregate(
          includeDeleted === true
            ? pipeline
            : [{ $match: NOT_DELETED }, ...pipeline]
        )
        .toArray()
      return toMonthlyCounts(result)
    }
  }
}

// Each write checks its input, makes the change and records its history entry
// inside run, so a caught failure at any step rolls the whole change back.
const appendHistory = (history, operation, registration, audit, at, session) =>
  history.append(historyEntry(operation, registration, audit, at), { session })

const changeExisting = (registrations, reference, update, session) =>
  registrations.findOneAndUpdate(
    visible({ reference }, false),
    { ...update, $inc: { version: 1 } },
    { returnDocument: 'after', projection: NO_ID, session }
  )

function createRegistration(context, registration, options) {
  const { run, registrations, history } = context
  const { by, reason, requestId, session } = options ?? {}
  return run(session, async (txSession) => {
    assertObject(registration, 'registration')
    assertReference(registration.reference)
    assertNoProtectedFields(registration, ['reference', SUBMITTED_AT])
    const audit = auditDetails({ by, reason, requestId })
    const document = {
      ...registration,
      isDeleted: false,
      version: FIRST_VERSION
    }
    const at = new Date()
    // insertOne adds _id to the object it's given, so give it a copy.
    await registrations.insertOne({ ...document }, { session: txSession })
    await appendHistory(
      history,
      HISTORY_OPERATION.CREATE,
      document,
      audit,
      at,
      txSession
    )
    return document
  })
}

// null when there's no such registration, or it's deleted.
function updateRegistration(context, reference, changes, options) {
  const { run, registrations, history } = context
  const { by, reason, requestId, session } = options ?? {}
  return run(session, async (txSession) => {
    assertReference(reference)
    assertObject(changes, 'changes')
    if (!Object.keys(changes).length) {
      throw new TypeError('changes must not be empty')
    }
    assertNoProtectedFields(changes)
    const audit = auditDetails({ by, reason, requestId })
    const at = new Date()
    const updated = await changeExisting(
      registrations,
      reference,
      { $set: changes },
      txSession
    )
    if (updated) {
      await appendHistory(
        history,
        HISTORY_OPERATION.UPDATE,
        updated,
        audit,
        at,
        txSession
      )
    }
    return updated
  })
}

// null when there's no such registration, or it's already deleted.
function softDeleteRegistration(context, reference, options) {
  const { run, registrations, history } = context
  const { by, reason, requestId, session } = options ?? {}
  return run(session, async (txSession) => {
    assertReference(reference)
    const audit = auditDetails({ by, reason, requestId })
    const at = new Date()
    const deleted = await changeExisting(
      registrations,
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
    if (deleted) {
      await appendHistory(
        history,
        HISTORY_OPERATION.DELETE,
        deleted,
        audit,
        at,
        txSession
      )
    }
    return deleted
  })
}

export function createAuditedRepository({ client, db }) {
  const registrations = db.collection(OCR_REGISTRATION_COLLECTION)
  const transactions = transactionRunner(client)
  const context = {
    run: transactions.run,
    registrations,
    history: createRegistrationHistory({ db })
  }

  return {
    ...readOperations(registrations),
    create: (registration, options) =>
      createRegistration(context, registration, options),
    update: (reference, changes, options) =>
      updateRegistration(context, reference, changes, options),
    softDelete: (reference, options) =>
      softDeleteRegistration(context, reference, options),
    withTransaction: transactions.withTransaction
  }
}
