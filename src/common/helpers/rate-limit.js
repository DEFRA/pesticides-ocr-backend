const MS_PER_SECOND = 1000

// Fixed-window request counter backed by Mongo, so throttling stays
// consistent with the rest of the app's persistence (no Redis in app code
// today, even though it's present in compose.yml). Each (key, window) pair
// gets its own bucket document that self-deletes via TTL once the window
// has passed.
export async function checkRateLimit(
  db,
  { collection, key, windowSeconds, max }
) {
  const bucket = Math.floor(Date.now() / (windowSeconds * MS_PER_SECOND))
  const bucketId = `${key}:${bucket}`
  const expiresAt = new Date((bucket + 1) * windowSeconds * MS_PER_SECOND)

  const result = await db
    .collection(collection)
    .findOneAndUpdate(
      { _id: bucketId },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after' }
    )

  return { limited: result.count > max, count: result.count }
}
