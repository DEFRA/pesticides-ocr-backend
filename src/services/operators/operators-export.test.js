import { describe, test, expect } from 'vitest'

import { toCsv } from './operators-export.js'

const operator = {
  reference: 'PPP-A1B-2C3',
  businessName: 'Pesticides Ltd',
  activities: ['Manufacture, process or import', 'Place on the market'],
  mainCustomer: 'N/A',
  address: {
    line1: 'Highfield Farm',
    town: 'Farmtown',
    postcode: 'PH1 1FT',
    country: ''
  },
  contact: {
    name: 'John Smith',
    email: 'john@pesticides.example',
    telephone: '01234 567890'
  },
  addressActivities: [],
  quantity: '80,000 litres or kilograms',
  registeredDate: '2026-03-11',
  status: 'Registered'
}

// The export is prefixed with a UTF-8 BOM so Excel reads it as UTF-8.
const BOM = '\uFEFF'
const HEADER =
  '"Reference","Business name","Registered date","Activities","Main customer",' +
  '"Contact name","Email","Telephone","Town","Postcode","Country","Status"'

describe('toCsv', () => {
  test('an empty list yields the header row only (BOM-prefixed)', () => {
    expect(toCsv([])).toBe(BOM + HEADER)
  })

  test('renders a header row followed by one row per operator (CRLF separated)', () => {
    const csv = toCsv([operator])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(BOM + HEADER)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"PPP-A1B-2C3"')
    expect(lines[1]).toContain('"Pesticides Ltd"')
    // multi-value activities are joined with "; "
    expect(lines[1]).toContain(
      '"Manufacture, process or import; Place on the market"'
    )
  })

  test('escapes embedded quotes (RFC 4180)', () => {
    const csv = toCsv([{ ...operator, businessName: 'A "B" Ltd' }])
    expect(csv).toContain('"A ""B"" Ltd"')
  })

  test('neutralises formula injection by prefixing a quote', () => {
    const csv = toCsv([{ ...operator, businessName: '=SUM(A1:A2)' }])
    expect(csv).toContain(`"'=SUM(A1:A2)"`)
  })

  test('tolerates missing nested fields without throwing', () => {
    const sparse = { reference: 'PPP-ZZZ-999' }
    const csv = toCsv([sparse])
    const cols = csv.split('\r\n')[1].split(',')
    expect(cols[0]).toBe('"PPP-ZZZ-999"')
    // contact/address/status absent -> empty quoted cells, no crash
    expect(cols).toHaveLength(12)
  })
})
