import { describe, test, expect, vi } from 'vitest'
import { checkRateLimit } from './rate-limit.js'

function makeDb(findOneAndUpdate) {
  return { collection: vi.fn(() => ({ findOneAndUpdate })) }
}

describe('checkRateLimit', () => {
  test('is not limited when the count is within max', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const db = makeDb(findOneAndUpdate)

    const result = await checkRateLimit(db, {
      collection: 'rate-limits',
      key: 'email:a@b.com',
      windowSeconds: 3600,
      max: 5
    })

    expect(result).toEqual({ limited: false, count: 1 })
  })

  test('is limited once the count exceeds max', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ count: 6 })
    const db = makeDb(findOneAndUpdate)

    const result = await checkRateLimit(db, {
      collection: 'rate-limits',
      key: 'email:a@b.com',
      windowSeconds: 3600,
      max: 5
    })

    expect(result).toEqual({ limited: true, count: 6 })
  })

  test('buckets by key and the current time window, and upserts', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const db = makeDb(findOneAndUpdate)

    await checkRateLimit(db, {
      collection: 'rate-limits',
      key: 'ip:127.0.0.1',
      windowSeconds: 3600,
      max: 5
    })

    expect(db.collection).toHaveBeenCalledWith('rate-limits')
    const [filter, update, options] = findOneAndUpdate.mock.calls[0]
    expect(filter._id).toMatch(/^ip:127\.0\.0\.1:\d+$/)
    expect(update.$inc).toEqual({ count: 1 })
    expect(update.$setOnInsert.expiresAt).toBeInstanceOf(Date)
    expect(options).toMatchObject({ upsert: true, returnDocument: 'after' })
  })
})
