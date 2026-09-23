import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'

// Append one timestamped journey event. Called by the (public) beacon
// controllers. When a verified session `nonce` is supplied it is stored under a
// unique index, so a replayed or repeated nonce for the same event is a
// duplicate-key no-op — each session's event counts once. A duplicate is
// therefore success, not error. Returns true when a new event was recorded,
// false when it was a deduped replay, so callers can log actual records rather
// than no-ops.
export async function recordEvent(db, { collection, dateField }, nonce) {
  const doc = { [dateField]: new Date() }
  if (nonce) {
    doc.nonce = nonce
  }
  try {
    await db.collection(collection).insertOne(doc)
    return true
  } catch (err) {
    if (err.code === MONGO_DUPLICATE_KEY_ERROR) {
      return false
    }
    throw err
  }
}
