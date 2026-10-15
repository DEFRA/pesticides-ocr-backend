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

  test('accepts exactly the maximum number of wildcards', () => {
    const { error } = searchQuerySchema(5).validate({ q: 'a*b*c*d*e*f' })

    expect(error).toBeUndefined()
  })

  test('rejects one wildcard over the maximum', () => {
    const { error } = searchQuerySchema(5).validate({ q: 'a*b*c*d*e*f*g' })

    expect(error.message).toBe('"q" must contain no more than 5 * wildcards')
  })

  test('counts a run of wildcards as one', () => {
    const { error } = searchQuerySchema(5).validate({ q: 'a**b***c*d*e*f' })

    expect(error).toBeUndefined()
  })

  test('ignores a blank criterion next to a valid one', () => {
    const { value, error } = searchQuerySchema(5).validate({
      reference: 'ABC',
      town: '  '
    })

    expect(error).toBeUndefined()
    expect(value).toEqual({ reference: 'ABC', page: 1, pageSize: 5 })
  })
})
