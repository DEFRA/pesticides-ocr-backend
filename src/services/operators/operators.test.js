import { describe, test, expect } from 'vitest'

import { toOperator, buildSearchFilter } from './operators.js'

// A representative stored registration document (the shape EQ-365 persists into
// the ocr-registration collection), used to assert the toOperator mapping.
const storedDoc = {
  reference: 'PPP-A1B-2C3',
  submittedAt: new Date('2026-03-11T09:30:00.000Z'),
  businessName: 'Pesticides Ltd',
  businessActivities: ['manufacture', 'market'],
  address: {
    line1: 'Highfield Farm',
    line2: '',
    town: 'Farmtown',
    county: '',
    postcode: 'PH1 1FT'
  },
  primaryContact: {
    name: 'John Smith',
    telephone: '01234 567890',
    email: 'john.smith@pesticides.co.uk'
  },
  addressActivities: ['use', 'store'],
  quantity: { quantityType: 'amount', quantity: 80000 }
}

describe('toOperator', () => {
  test('maps stored fields onto the Operator contract', () => {
    const operator = toOperator(storedDoc)

    expect(operator).toEqual({
      reference: 'PPP-A1B-2C3',
      businessName: 'Pesticides Ltd',
      activities: [
        'Manufacture, process or import',
        'Place on the market or distribute'
      ],
      mainCustomer: 'N/A',
      address: {
        line1: 'Highfield Farm',
        town: 'Farmtown',
        postcode: 'PH1 1FT',
        country: ''
      },
      contact: {
        name: 'John Smith',
        email: 'john.smith@pesticides.co.uk',
        telephone: '01234 567890'
      },
      addressActivities: [
        'Use plant protection products (PPPs) or adjuvants',
        'Store plant protection products (PPPs) or adjuvants'
      ],
      quantity: '80,000 litres or kilograms',
      registeredDate: '2026-03-11',
      status: 'Registered'
    })
  })

  test('formats an area quantity as hectares', () => {
    const operator = toOperator({
      ...storedDoc,
      quantity: { quantityType: 'area', quantity: 1500 }
    })
    expect(operator.quantity).toBe('1,500 hectares')
  })

  test('prefers a stored mainCustomer/status/country when present (forward-compatible)', () => {
    const operator = toOperator({
      ...storedDoc,
      mainCustomer: 'Professional users',
      status: 'Suspended',
      address: { ...storedDoc.address, country: 'England' }
    })
    expect(operator.mainCustomer).toBe('Professional users')
    expect(operator.status).toBe('Suspended')
    expect(operator.address.country).toBe('England')
  })

  test('falls back to the raw slug for an unknown activity code', () => {
    const operator = toOperator({
      ...storedDoc,
      businessActivities: ['manufacture', 'some-new-code']
    })
    expect(operator.activities).toEqual([
      'Manufacture, process or import',
      'some-new-code'
    ])
  })

  test('tolerates a sparse document without throwing', () => {
    const operator = toOperator({ reference: 'PPP-ZZZ-999' })

    expect(operator.reference).toBe('PPP-ZZZ-999')
    expect(operator.businessName).toBe('')
    expect(operator.activities).toEqual([])
    expect(operator.addressActivities).toEqual([])
    expect(operator.quantity).toBe('')
    expect(operator.registeredDate).toBe('')
    expect(operator.address).toEqual({
      line1: '',
      town: '',
      postcode: '',
      country: ''
    })
    expect(operator.contact).toEqual({ name: '', email: '', telephone: '' })
    expect(operator.status).toBe('Registered')
  })

  test('omits stored fields not in the Operator contract', () => {
    const operator = toOperator({
      ...storedDoc,
      address: { ...storedDoc.address, line2: 'Unit 2', county: 'Surrey' },
      professionalSectors: ['forestry'],
      memberSchemes: ['Red Tractor'],
      additionalAddresses: [{ address: {}, contact: {}, activity: ['use'] }]
    })
    expect(operator.address).not.toHaveProperty('line2')
    expect(operator.address).not.toHaveProperty('county')
    expect(operator).not.toHaveProperty('professionalSectors')
    expect(operator).not.toHaveProperty('memberSchemes')
    expect(operator).not.toHaveProperty('additionalAddresses')
  })
})

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
      'primaryContact.name',
      'address.town',
      'address.postcode'
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
