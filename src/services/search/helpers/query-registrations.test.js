import { queryRegistrations } from './query-registrations.js'
import { buildSearchFilter } from './search-filter.js'
import { storedDoc } from '#/services/search/search.fixtures.js'

describe('#queryRegistrations', () => {
  let registrations

  beforeEach(() => {
    registrations = { search: vi.fn().mockResolvedValue([storedDoc]) }
  })

  test('searches newest first with the given limit', async () => {
    await queryRegistrations(registrations, { query: '', limit: 5 })

    expect(registrations.search).toHaveBeenCalledWith(
      {},
      { sort: { submittedAt: -1 }, limit: 5 }
    )
  })

  test('returns the stored registrations unchanged, leaving presentation to the caller', async () => {
    const result = await queryRegistrations(registrations, {
      query: '',
      limit: 5
    })

    expect(result).toEqual([storedDoc])
  })

  test('passes the built search filter for a non-blank query', async () => {
    await queryRegistrations(registrations, { query: 'green', limit: 5 })

    expect(registrations.search).toHaveBeenCalledWith(
      buildSearchFilter('green'),
      expect.objectContaining({ limit: 5 })
    )
  })

  test('passes a missing limit on, so the repository rejects an uncapped read', async () => {
    await queryRegistrations(registrations, { query: '' })

    expect(registrations.search).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ limit: undefined })
    )
  })
})
