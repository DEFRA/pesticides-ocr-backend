import { queryOperators } from '#/services/operators/helpers/query-operators.js'

// Controller for GET /operators/export (EQ-369): the current (filtered) operator
// set as a CSV download. Same query as the grid but uncapped (limit 0 = Mongo's
// "no cap"), so the export is the full matching set, not one page. The CSV
// serialisation lives here too — the export is its only consumer.

// Column heading -> value getter. The column set mirrors the frontend export
// contract (operators-data.js) so a backend export matches the dashboard grid.
// Getters are null-safe so a record with a missing contact/address/activities
// can't break the export.
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

// Render operators as CSV. The first row is the column headings; an empty list
// yields the header row only. Exported for unit testing of the serialisation.
export function toCsv(operators) {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')
  const rows = operators.map((op) =>
    CSV_COLUMNS.map(([, get]) => csvCell(get(op))).join(',')
  )
  return UTF8_BOM + [header, ...rows].join('\r\n')
}

// Returns the row count alongside the CSV so the route can audit the bulk
// download without re-querying. `limit: 0` means "no cap" — the export needs the
// full matching set, not just the first page.
//
// POC caveat: the uncapped export buffers every matching row and builds the
// whole CSV in memory. Fine at POC volumes; before this holds production data,
// add a hard ceiling (e.g. MAX_EXPORT_ROWS) and/or stream the CSV. Tracked on
// the EQ-385 hardening follow-up.
export async function exportOperators(db, { query = '' } = {}) {
  const operators = await queryOperators(db, { query, limit: 0 })
  return { csv: toCsv(operators), rowCount: operators.length }
}
