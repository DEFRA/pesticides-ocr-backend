import { searchQuerySchema } from './search-query.js'

describe('#searchQuerySchema', () => {
  test('lowers the default page size to a cap below it', () => {
    const { value } = searchQuerySchema(5).validate({ q: 'ABC' })

    expect(value).toEqual({ q: 'ABC', page: 1, pageSize: 5 })
  })

  test('rejects a page size over the cap', () => {
    const { error } = searchQuerySchema(5).validate({ q: 'ABC', pageSize: 6 })

    expect(error.message).toBe('"pageSize" must be less than or equal to 5')
  })
})
