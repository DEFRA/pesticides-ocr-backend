import { describe, test, expect } from 'vitest'

import { exportOneToCsv } from './export.js'

// A stored registration, trimmed to the flat fields the single-record export
// currently handles cleanly.
const item = {
  reference: 'PPP-A1B-2C3',
  businessName: 'Pesticides Ltd',
  mainCustomer: 'Farmers'
}

describe('exportOneToCsv', () => {
  test('renders a header row of keys followed by one row of values', () => {
    expect(exportOneToCsv(item)).toBe(
      'reference,businessName,mainCustomer\n' +
        'PPP-A1B-2C3,Pesticides Ltd,Farmers\n'
    )
  })

  test('both rows are newline terminated', () => {
    const lines = exportOneToCsv(item).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
  })

  test('columns follow the insertion order of the record keys', () => {
    const reordered = {
      mainCustomer: 'Farmers',
      reference: 'PPP-A1B-2C3',
      businessName: 'Pesticides Ltd'
    }
    const [header, values] = exportOneToCsv(reordered).split('\n')
    expect(header).toBe('mainCustomer,reference,businessName')
    expect(values).toBe('Farmers,PPP-A1B-2C3,Pesticides Ltd')
  })

  test('stringifies non-string scalars', () => {
    const csv = exportOneToCsv({ quantity: 80000, active: true })
    expect(csv).toBe('quantity,active\n80000,true\n')
  })

  test('renders null and undefined as empty cells', () => {
    const csv = exportOneToCsv({ a: null, b: undefined, c: 'x' })
    expect(csv).toBe('a,b,c\n,,x\n')
  })

  test('an empty record yields two blank lines', () => {
    expect(exportOneToCsv({})).toBe('\n\n')
  })

  // --- Documented gaps -----------------------------------------------------
  // The three tests below pin CURRENT behaviour, not desired behaviour. Unlike
  // the operators export (services/operators/operators-export.js) this
  // serialiser does no RFC 4180 quoting, no formula-injection guard and no
  // nested-field mapping. They are here so the gaps are visible and so a fix
  // has to update a test rather than pass silently.

  test('does not quote values containing a comma, so columns misalign', () => {
    const csv = exportOneToCsv({ ...item, businessName: 'Smith, Jones & Co' })
    const [header, values] = csv.split('\n')
    expect(header.split(',')).toHaveLength(3)
    // The embedded comma reads as a column separator: 3 headings, 4 values.
    expect(values.split(',')).toHaveLength(4)
  })

  test('does not neutralise a formula-injection value', () => {
    const csv = exportOneToCsv({ businessName: '=SUM(A1:A2)' })
    expect(csv).toBe('businessName\n=SUM(A1:A2)\n')
  })

  test('flattens a nested field to [object Object]', () => {
    const csv = exportOneToCsv({
      reference: 'PPP-A1B-2C3',
      address: { town: 'Farmtown', postcode: 'PH1 1FT' }
    })
    expect(csv).toBe('reference,address\nPPP-A1B-2C3,[object Object]\n')
  })

  test('throws when there is no record to export', () => {
    expect(() => exportOneToCsv(null)).toThrow(TypeError)
    expect(() => exportOneToCsv(undefined)).toThrow(TypeError)
  })
})
