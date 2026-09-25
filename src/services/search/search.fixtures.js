// Shared test fixture for the search and export services: a representative
// stored registration document (the shape EQ-365 persists into the
// ocr-registration collection), used across the search helper tests and the
// CSV export tests.
export const storedDoc = {
  reference: 'PPP-A1B-2C3',
  submittedAt: new Date('2026-03-11T09:30:00.000Z'),
  businessName: 'Pesticides Ltd',
  businessActivities: ['manufacture', 'market'],
  address: {
    addressLine1: 'Highfield Farm',
    addressLine2: '',
    addressTown: 'Farmtown',
    addressCounty: '',
    addressPostcode: 'PH1 1FT'
  },
  primaryContact: {
    contactName: 'John Smith',
    contactTelephone: '01234 567890',
    contactEmail: 'john.smith@pesticides.co.uk'
  },
  addressActivities: ['use', 'store'],
  quantity: { quantityType: 'amount', quantity: 80000 }
}
