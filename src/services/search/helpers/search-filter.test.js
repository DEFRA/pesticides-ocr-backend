import { buildCriteriaFilter, buildSearchFilter } from './search-filter.js'

const storedFields = [
  'reference',
  'businessName',
  'primaryContact.contactName',
  'primaryContact.contactEmail',
  'address.addressTown',
  'address.addressPostcode'
]

const fieldsOf = (clauses) => clauses.map((clause) => Object.keys(clause)[0])

describe('buildSearchFilter', () => {
  test('a blank, whitespace or absent term matches everything', () => {
    expect(buildSearchFilter('')).toEqual({})
    expect(buildSearchFilter('   ')).toEqual({})
    expect(buildSearchFilter(undefined)).toEqual({})
  })

  test('searches every searchable field, case-insensitively', () => {
    const filter = buildSearchFilter('acme')
    expect(fieldsOf(filter.$or)).toEqual(storedFields)
    for (const clause of filter.$or) {
      const rx = Object.values(clause)[0]
      expect(rx).toBeInstanceOf(RegExp)
      expect(rx.flags).toContain('i')
    }
  })

  test('escapes regex metacharacters, * included, so the term matches literally', () => {
    const pattern = buildSearchFilter('a.b(c*').$or[0].reference
    expect(pattern.test('a.b(c*')).toBe(true)
    expect(pattern.test('aXbXc')).toBe(false)
    expect(pattern.test('a.b(cd')).toBe(false)
  })
})

describe('buildCriteriaFilter', () => {
  test('no criteria matches everything', () => {
    expect(buildCriteriaFilter({})).toEqual({})
    expect(buildCriteriaFilter()).toEqual({})
  })

  test('q matches any searchable field', () => {
    const filter = buildCriteriaFilter({ q: 'acme' })
    expect(filter.$and).toHaveLength(1)
    expect(fieldsOf(filter.$and[0].$or)).toEqual(storedFields)
  })

  test('maps each named criterion onto its stored field, all of which must match', () => {
    const filter = buildCriteriaFilter({
      reference: 'ABC',
      organisationName: 'acme',
      applicantName: 'smith',
      email: '@acme',
      town: 'norwich',
      postcode: 'NR1'
    })
    expect(fieldsOf(filter.$and)).toEqual(storedFields)
  })

  test('combines q with named criteria, and leaves out those not supplied', () => {
    const filter = buildCriteriaFilter({ q: 'acme', email: 'jane' })
    expect(filter.$and).toHaveLength(2)
    expect(filter.$and[0]).toHaveProperty('$or')
    expect(fieldsOf([filter.$and[1]])).toEqual(['primaryContact.contactEmail'])
  })

  test('matches a partial term case-insensitively', () => {
    const pattern = buildCriteriaFilter({ reference: 'abc' }).$and[0].reference
    expect(pattern.test('PPP-ABC-123')).toBe(true)
    expect(pattern.test('PPP-AB1-23C')).toBe(false)
  })

  test('treats * as any run of characters', () => {
    const pattern = buildCriteriaFilter({ reference: 'PPP-*-123' }).$and[0]
      .reference
    expect(pattern.test('PPP-ABC-123')).toBe(true)
    expect(pattern.test('PPP--123')).toBe(true)
    expect(pattern.test('PPP-ABC-124')).toBe(false)
  })

  test('escapes every other regex metacharacter', () => {
    const pattern = buildCriteriaFilter({ organisationName: 'a.b(c' }).$and[0]
      .businessName
    expect(pattern.test('a.b(c')).toBe(true)
    expect(pattern.test('aXb(c')).toBe(false)
  })
})
