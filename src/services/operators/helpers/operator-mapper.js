// Maps stored registration documents onto the frontend Operator contract (EQ-385).
//
// The dashboard's contract is the frontend Operator shape (see the frontend stub
// operators-data.js): a flat, display-ready record. Stored registrations use a
// different shape — coded activity slugs, a structured quantity, no country /
// status / mainCustomer. `toOperator` is the single seam that maps one to the
// other, so the frontend can drop its stub and become a thin adapter.

// --- POC mapping defaults --------------------------------------------------
// Fields the Operator contract needs but the register journey does not (yet)
// persist. These are the EQ-385 "data-model mapping" open decisions — confirm
// with HSE/Yankui before production. Isolated in this mapper so a decision
// changes one place.
//   - status:       no approval/status workflow exists; treated as Registered.
//   - country:      the register journey captures postcode/county but not a
//                   country; left blank until the field is added.
//   - mainCustomer: the journey DOES collect it (a /main-customer step), but the
//                   backend schema/write (EQ-365) does not store it yet, so it is
//                   read forward-compatibly and defaulted until the write lands.
const DEFAULT_STATUS = 'Registered'
const DEFAULT_COUNTRY = ''
const DEFAULT_MAIN_CUSTOMER = 'N/A'

// Coded slug -> display label. Stored values are the register-form codes; the
// grid shows human labels. Unknown codes fall back to the raw slug.
const BUSINESS_ACTIVITY_LABELS = {
  manufacture: 'Manufacture, process or import',
  market: 'Place on the market or distribute',
  'seller-professional': 'Sell professional PPPs',
  'seller-amateur': 'Sell amateur PPPs',
  'use-professional': 'Use professional PPPs'
}

const ADDRESS_ACTIVITY_LABELS = {
  use: 'Use plant protection products (PPPs) or adjuvants',
  store: 'Store plant protection products (PPPs) or adjuvants',
  records: 'Keep records of plant protection products (PPPs)'
}

const labelFor = (map) => (code) => map[code] ?? code

// Format the structured stored quantity into the grid's display string. The
// journey records only a number + type (not a specific unit), so `amount` is
// rendered as "N litres or kilograms" and `area` as hectares.
function formatQuantity(quantity) {
  if (!quantity || typeof quantity.quantity !== 'number') {
    return ''
  }
  const amount = quantity.quantity.toLocaleString('en-GB')
  if (quantity.quantityType === 'area') {
    return `${amount} hectares`
  }
  return `${amount} litres or kilograms`
}

// `submittedAt` (a Date) -> yyyy-mm-dd, matching the contract's registeredDate.
function toIsoDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : ''
}

// The Operator contract carries only line1/town/postcode/country; the stored
// address.line2/county are intentionally dropped (not shown on the grid).
function mapAddress(address = {}) {
  return {
    line1: address.addressLine1 ?? '',
    town: address.addressTown ?? '',
    postcode: address.addressPostcode ?? '',
    country: address.addressCountry ?? DEFAULT_COUNTRY
  }
}

function mapContact(contact = {}) {
  return {
    name: contact.contactName ?? '',
    email: contact.contactEmail ?? '',
    telephone: contact.contactTelephone ?? ''
  }
}

// Map a stored registration document onto the frontend Operator contract.
// Stored fields with no place in the contract are intentionally omitted:
// address.line2/county (see mapAddress), and additionalAddresses /
// professionalSectors / memberSchemes — see the EQ-385 data-model decision.
export function toOperator(doc) {
  return {
    reference: doc.reference ?? '',
    businessName: doc.businessName ?? '',
    activities: (doc.businessActivities ?? []).map(
      labelFor(BUSINESS_ACTIVITY_LABELS)
    ),
    mainCustomer: doc.mainCustomer ?? DEFAULT_MAIN_CUSTOMER,
    address: mapAddress(doc.address),
    contact: mapContact(doc.primaryContact),
    addressActivities: (doc.addressActivities ?? []).map(
      labelFor(ADDRESS_ACTIVITY_LABELS)
    ),
    quantity: formatQuantity(doc.quantity),
    registeredDate: toIsoDate(doc.submittedAt),
    status: doc.status ?? DEFAULT_STATUS
  }
}
