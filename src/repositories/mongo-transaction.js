// Reads in a transaction must use the primary, and CDP's MONGO_URI sets
// readPreference=secondaryPreferred, so the transaction overrides it.
export const transactionOptions = {
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' }
}

// The driver retries transient errors, so work must be safe to run again.
export function withTransaction(client, work) {
  return client.withSession((session) =>
    session.withTransaction(() => work(session), transactionOptions)
  )
}
