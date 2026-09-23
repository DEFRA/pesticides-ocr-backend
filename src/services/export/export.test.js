import { describe, test, expect } from 'vitest'

import { toCsv, exportToCsv } from './export.js'
import { storedDoc } from '#/services/search/search.fixtures.js'

// The export is prefixed with a UTF-8 BOM so Excel reads it as UTF-8.
const BOM = '\uFEFF'
const HEADER =
  '"Reference","Business name","Registered date","Activities","Main customer",' +
  '"Contact name","Email","Telephone","Town","Postcode","Country","Status"'

const COLUMN_COUNT = 12

describe('toCsv', () => {
  test('an empty list yields the header row only (BOM-prefixed)', () => {
    expect(toCsv([])).toBe(BOM + HEADER)
  })

  test('renders a header row followed by one row per registration (CRLF separated)', () => {
    const lines = toCsv([storedDoc]).split('\r\n')

    expect(lines[0]).toBe(BOM + HEADER)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"PPP-A1B-2C3"')
    expect(lines[1]).toContain('"Pesticides Ltd"')
  })

  test('reads the stored registration fields, not a presentation shape', () => {
    const row = toCsv([storedDoc]).split('\r\n')[1]

    // Nested stored field names (primaryContact/address), not mapped ones.
    expect(row).toContain('"John Smith"')
    expect(row).toContain('"john.smith@pesticides.co.uk"')
    expect(row).toContain('"Farmtown"')
    expect(row).toContain('"PH1 1FT"')
  })

  test('joins multi-value activities with a semicolon, as stored codes', () => {
    const row = toCsv([storedDoc]).split('\r\n')[1]

    expect(row).toContain('"manufacture; market"')
  })

  test('defaults Status to Registered, matching what the grid shows', () => {
    const row = toCsv([storedDoc]).split('\r\n')[1]

    // No status workflow exists, so nothing persists one; a blank column here
    // would contradict the dashboard.
    expect(row.endsWith('"Registered"')).toBe(true)
  })

  test('prefers a stored status over the default once one exists', () => {
    const row = toCsv([{ ...storedDoc, status: 'Suspended' }]).split('\r\n')[1]

    expect(row.endsWith('"Suspended"')).toBe(true)
  })

  test('renders the stored Date as a calendar day', () => {
    const row = toCsv([storedDoc]).split('\r\n')[1]

    expect(row).toContain('"2026-03-11"')
  })

  test('leaves the date cell empty when it is missing or unparseable', () => {
    expect(toCsv([{ reference: 'PPP-ZZZ-999' }])).toContain('"",')
    expect(
      toCsv([{ submittedAt: 'not-a-date' }]).split('\r\n')[1]
    ).not.toContain('NaN')
  })

  test('escapes embedded quotes (RFC 4180)', () => {
    const csv = toCsv([{ ...storedDoc, businessName: 'A "B" Ltd' }])

    expect(csv).toContain('"A ""B"" Ltd"')
  })

  test('neutralises formula injection by prefixing a quote', () => {
    const csv = toCsv([{ ...storedDoc, businessName: '=SUM(A1:A2)' }])

    expect(csv).toContain(`"'=SUM(A1:A2)"`)
  })

  test('tolerates missing nested fields without throwing', () => {
    const cols = toCsv([{ reference: 'PPP-ZZZ-999' }])
      .split('\r\n')[1]
      .split(',')

    expect(cols[0]).toBe('"PPP-ZZZ-999"')
    // contact/address/status absent -> empty quoted cells, no crash
    expect(cols).toHaveLength(COLUMN_COUNT)
  })
})

describe('#exportToCsv', () => {
  test('is pure: it serialises the rows it is given and needs no database', () => {
    const { csv, rowCount } = exportToCsv([storedDoc])

    expect(rowCount).toBe(1)
    expect(csv.split('\r\n')).toHaveLength(2)
    expect(csv.split('\r\n')[0]).toBe(BOM + HEADER)
  })

  test('reports the row count so the route can audit without re-counting', () => {
    expect(exportToCsv([storedDoc, storedDoc]).rowCount).toBe(2)
  })

  test('defaults to an empty list, yielding the header row and a zero count', () => {
    const { csv, rowCount } = exportToCsv()

    expect(rowCount).toBe(0)
    expect(csv).toBe(BOM + HEADER)
  })
})
