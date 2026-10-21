import { createHmac, randomBytes } from 'node:crypto'

import { EMAIL_VERIFICATIONS_COLLECTION } from '#/common/constants/collections.js'
import { STATUS } from '#/services/email-verification/verification-records.js'

export const JOURNEY_SECRET = 'journey-test-secret'
export const JOURNEY = 'journey-0f2b8c1e-7a4d-4e9b-9c6f-1d2e3f4a5b6c'
export const OTHER_JOURNEY = 'journey-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
export const CONTACT_EMAIL = 'spray@everything.biz'

const MS_PER_SECOND = 1000
const SECONDS_PER_DAY = 86400

// A journey token as the frontend signs it: `<nonce>.<HMAC of the nonce>`.
export const journeyToken = (nonce, secret = JOURNEY_SECRET) =>
  `${nonce}.${createHmac('sha256', secret).update(nonce).digest('hex')}`

export const validRegistrationPayload = {
  businessActivities: ['manufacture', 'market'],
  mainCustomer: 'professional',
  businessName: 'Company 1',
  address: {
    addressLine1: '67 My Road',
    addressLine2: 'My Village',
    addressTown: 'My Town',
    addressCounty: 'North Yorkshire',
    addressPostcode: 'AB12 3CD'
  },
  primaryContact: {
    contactName: 'Jonny Pesticide',
    contactTelephone: '01234567890',
    contactEmail: CONTACT_EMAIL
  },
  addressActivities: ['use', 'store'],
  quantity: { quantityType: 'area', quantity: '67' },
  professionalSectors: ['agriculture-horticulture', 'amenity'],
  memberSchemes: ['Scheme A'],
  additionalAddresses: [
    {
      address: {
        addressLine1: '1 Other St',
        addressTown: 'Othertown',
        addressPostcode: 'SW1A 2AA'
      },
      contact: {
        contactName: 'Jane Doe',
        contactTelephone: '07700900000',
        contactEmail: 'jane@example.com'
      },
      activity: ['use']
    }
  ]
}

// Stores a record as a used magic link leaves it. `email` is stored as given,
// so pass it normalised, as the request endpoint stores it.
export async function seedVerification(
  db,
  { journeyId = JOURNEY, email = CONTACT_EMAIL, verifiedAt = new Date() } = {}
) {
  await db.collection(EMAIL_VERIFICATIONS_COLLECTION).insertOne({
    journeyId,
    email,
    tokenHash: randomBytes(32).toString('hex'),
    status: STATUS.VERIFIED,
    createdAt: verifiedAt,
    expiresAt: verifiedAt,
    verifiedAt,
    supersededAt: null,
    purgeAt: new Date(verifiedAt.getTime() + SECONDS_PER_DAY * MS_PER_SECOND)
  })
}
