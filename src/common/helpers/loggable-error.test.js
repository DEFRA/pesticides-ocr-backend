import { describe, test, expect } from 'vitest'
import { MongoServerError } from 'mongodb'

import { loggableError } from '#/common/helpers/loggable-error.js'

const TOKEN_HASH = 'f'.repeat(64)

const duplicateKeyError = () =>
  new MongoServerError({
    code: 11000,
    errmsg: `E11000 duplicate key error collection: test.emailVerifications index: tokenHash_1 dup key: { tokenHash: "${TOKEN_HASH}" }`,
    keyValue: { tokenHash: TOKEN_HASH }
  })

describe('#loggableError', () => {
  test('keeps only the name and code of a duplicate key error', () => {
    const safe = loggableError(duplicateKeyError())

    expect(safe).toBeInstanceOf(Error)
    expect(safe.name).toBe('MongoServerError')
    expect(safe.code).toBe(11000)
    expect(JSON.stringify({ ...safe, message: safe.message })).not.toContain(
      TOKEN_HASH
    )
    expect(safe.stack).not.toContain(TOKEN_HASH)
  })

  test('returns any other error as it is', () => {
    const error = new TypeError('boom')

    expect(loggableError(error)).toBe(error)
  })
})
