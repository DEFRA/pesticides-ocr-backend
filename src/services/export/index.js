// Controller for GET /export (EQ-369, EQ-366). A pure transformer: it takes
// rows already fetched by search and returns the CSV. It touches no database,
// so the route composes search then export and this stays trivially testable.
//
// Rows are stored registrations, not a presentation shape, so this is a data
// export: activity codes appear as stored rather than as the case-officer
// labels. The dashboard renders its own display CSV from the mapped view.

// No status workflow exists yet, so the register never persists one. The grid
// shows "Registered" for every record, and the export has to agree with it —
// a blank Status column next to a screen that says Registered reads as a bug.
// This duplicates the frontend's default deliberately; both move together when
// a real status lands (the EQ-385 data-model decision).
const DEFAULT_STATUS = 'Registered'

// Column heading -> value getter, reading the stored registration. Getters are
// null-safe so a record with a missing contact, address or activity list can't
// break the export.
const CSV_COLUMNS = [
  ['Reference', (doc) => doc.reference],
  ['Business name', (doc) => doc.businessName],
  ['Registered date', (doc) => toIsoDate(doc.submittedAt)],
  ['Activities', (doc) => (doc.businessActivities ?? []).join('; ')],
  ['Main customer', (doc) => doc.mainCustomer],
  ['Contact name', (doc) => doc.primaryContact?.contactName],
  ['Email', (doc) => doc.primaryContact?.contactEmail],
  ['Telephone', (doc) => doc.primaryContact?.contactTelephone],
  ['Town', (doc) => doc.address?.addressTown],
  ['Postcode', (doc) => doc.address?.addressPostcode],
  ['Country', (doc) => doc.address?.addressCountry],
  ['Status', (doc) => doc.status ?? DEFAULT_STATUS]
]

// A cell starting with any of these is treated as a formula by Excel/Sheets.
// Prefix such values with a single quote so they render as text — matters once
// operator-supplied names flow through this seam (CSV injection).
const CSV_FORMULA_PREFIXES = /^[=+\-@\t\r]/

// Prepended so Excel opens the file as UTF-8; without a BOM it assumes ANSI and
// mangles accented characters in names/addresses.
const UTF8_BOM = '\uFEFF'

// Dates are stored as Date; render the calendar day only.
const ISO_DATE_LENGTH = 10
function toIsoDate(value) {
  if (!value) {
    return ''
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, ISO_DATE_LENGTH)
}

// Quote a CSV field (RFC 4180), escape embedded quotes, and neutralise formula
// injection.
function csvCell(value) {
  const raw = String(value ?? '')
  const safe = CSV_FORMULA_PREFIXES.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

// Render registrations as CSV. The first row is the column headings; an empty
// list yields the header row only. Exported for unit testing of the
// serialisation.
export function toCsv(registrations) {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')
  const rows = registrations.map((doc) =>
    CSV_COLUMNS.map(([, get]) => csvCell(get(doc))).join(',')
  )
  return UTF8_BOM + [header, ...rows].join('\r\n')
}

// Returns the row count alongside the CSV so the route can audit the bulk
// download without re-counting.
export function exportToCsv(registrations = []) {
  return { csv: toCsv(registrations), rowCount: registrations.length }
}
