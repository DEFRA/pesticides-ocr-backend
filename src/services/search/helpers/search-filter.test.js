import { buildSearchFilter } from './search-filter.js'

describe('buildSearchFilter', () => {
  test('a blank, whitespace or absent term matches everything', () => {
    expect(buildSearchFilter('')).toEqual({})
    expect(buildSearchFilter('   ')).toEqual({})
    expect(buildSearchFilter(undefined)).toEqual({})
  })

  test('searches all five contract fields, case-insensitively', () => {
    const filter = buildSearchFilter('acme')
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'reference',
      'businessName',
      'primaryContact.contactName',
      'address.addressTown',
      'address.addressPostcode'
    ])
    for (const clause of filter.$or) {
      const rx = Object.values(clause)[0]
      expect(rx).toBeInstanceOf(RegExp)
      expect(rx.flags).toContain('i')
    }
  })

  test('escapes regex metacharacters so the term matches literally', () => {
    const rx = buildSearchFilter('a.b(c').$or[0].reference
    expect(rx.test('a.b(c')).toBe(true) // exact literal matches
    expect(rx.test('aXbXc')).toBe(false) // '.' is not treated as a wildcard
  })
})
