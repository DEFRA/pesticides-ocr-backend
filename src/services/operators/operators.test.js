import { searchOperators, MAX_RESULTS } from '#/services/operators/operators.js'
import { toOperator } from '#/services/operators/helpers/operator-mapper.js'
import { buildSearchFilter } from '#/services/operators/helpers/search-filter.js'
import { storedDoc } from '#/services/operators/operators.fixtures.js'

describe('#searchOperators (GET /operators controller)', () => {
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

  test('caps the paged grid at MAX_RESULTS and maps to the Operator contract', async () => {
    const result = await searchOperators(db, { query: '' })

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(sort).toHaveBeenCalledWith({ submittedAt: -1 })
    expect(cursor.limit).toHaveBeenCalledWith(MAX_RESULTS)
    expect(result).toEqual([toOperator(storedDoc)])
  })

  test('forwards the search term as the built filter', async () => {
    await searchOperators(db, { query: 'green' })

    expect(find).toHaveBeenCalledWith(buildSearchFilter('green'), {
      projection: { _id: 0 }
    })
  })
})
