// Also drives /export's free-text match.
export const searchFields = {
  reference: 'reference',
  organisationName: 'businessName',
  applicantName: 'primaryContact.contactName',
  email: 'primaryContact.contactEmail',
  town: 'address.addressTown',
  postcode: 'address.addressPostcode'
}

export const WILDCARD = '*'

export const collapseWildcards = (term) => term.replaceAll(/\*+/g, WILDCARD)
