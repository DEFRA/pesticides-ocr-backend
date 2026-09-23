import { queryRegistrations } from './query-registrations.js'
import { buildSearchFilter } from './search-filter.js'
import { storedDoc } from '#/services/search/search.fixtures.js'

describe('#queryRegistrations', () => {
  let cursor
  let sort
  let find
  let collection
  let db

  beforeEach(() => {
    // Chainable Mongo cursor stub: find().sort().limit().toArray()
    cursor = { toArray: vi.fn().mockResolvedValue([storedDoc]) }
    cursor.limit = vi.fn().mockReturnValue(cursor)
    sort = vi.fn().mockReturnValue(cursor)
    find = vi.fn().mockReturnValue({ sort })
    collection = vi.fn().mockReturnValue({ find })
    db = { collection }
  })

  test('queries ocr-registration newest-first with the given limit', async () => {
    await queryRegistrations(db, { query: '', limit: 5 })

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 0 } })
    expect(sort).toHaveBeenCalledWith({ submittedAt: -1 })
    expect(cursor.limit).toHaveBeenCalledWith(5)
  })

  test('returns the stored registrations unchanged, leaving presentation to the caller', async () => {
    const result = await queryRegistrations(db, { query: '', limit: 5 })

    expect(result).toEqual([storedDoc])
  })

  test('passes the built search filter for a non-blank query', async () => {
    await queryRegistrations(db, { query: 'green', limit: 5 })

    expect(find).toHaveBeenCalledWith(buildSearchFilter('green'), {
      projection: { _id: 0 }
    })
  })

  test('defaults to limit 0 (Mongo "no cap") when no limit is given', async () => {
    await queryRegistrations(db, { query: '' })

    expect(cursor.limit).toHaveBeenCalledWith(0)
    expect(cursor.toArray).toHaveBeenCalled()
  })
})
