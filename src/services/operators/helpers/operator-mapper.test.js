import { toOperator } from './operator-mapper.js'
import { storedDoc } from '#/services/operators/operators.fixtures.js'

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

  test('prefers a stored mainCustomer/status/country when present', () => {
    const operator = toOperator({
      ...storedDoc,
      mainCustomer: 'Professional users',
      status: 'Suspended',
      address: { ...storedDoc.address, addressCountry: 'England' }
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
      address: {
        ...storedDoc.address,
        addressLine2: 'Unit 2',
        addressCounty: 'Surrey'
      },
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
