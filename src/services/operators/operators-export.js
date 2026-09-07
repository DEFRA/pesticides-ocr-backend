// CSV serialisation for the operator export (EQ-369).
//
// Renders the Operator records (from searchOperators) as CSV for the case-officer
// export/download. The column set mirrors the frontend export contract
// (operators-data.js) so a backend export matches the dashboard grid.

// Column heading -> value getter. Getters are null-safe so a record with a
// missing contact/address/activities can't break the export.
const CSV_COLUMNS = [
  ['Reference', (op) => op.reference],
  ['Business name', (op) => op.businessName],
  ['Registered date', (op) => op.registeredDate],
  ['Activities', (op) => (op.activities ?? []).join('; ')],
  ['Main customer', (op) => op.mainCustomer],
  ['Contact name', (op) => op.contact?.name],
  ['Email', (op) => op.contact?.email],
  ['Telephone', (op) => op.contact?.telephone],
  ['Town', (op) => op.address?.town],
  ['Postcode', (op) => op.address?.postcode],
  ['Country', (op) => op.address?.country],
  ['Status', (op) => op.status]
]

// A cell starting with any of these is treated as a formula by Excel/Sheets.
// Prefix such values with a single quote so they render as text — matters once
// operator-supplied names flow through this seam (CSV injection).
const CSV_FORMULA_PREFIXES = /^[=+\-@\t\r]/

// Prepended so Excel opens the file as UTF-8; without a BOM it assumes ANSI and
// mangles accented characters in names/addresses.
const UTF8_BOM = '\uFEFF'

// Quote a CSV field (RFC 4180), escape embedded quotes, and neutralise formula
// injection.
function csvCell(value) {
  const raw = String(value ?? '')
  const safe = CSV_FORMULA_PREFIXES.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

// Render operators as CSV (Export API). The first row is the column headings; an
// empty list yields the header row only.
export function toCsv(operators) {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')
  const rows = operators.map((op) =>
    CSV_COLUMNS.map(([, get]) => csvCell(get(op))).join(',')
  )
  return UTF8_BOM + [header, ...rows].join('\r\n')
}
