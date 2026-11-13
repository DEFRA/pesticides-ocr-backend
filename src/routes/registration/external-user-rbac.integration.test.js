import { randomBytes } from 'node:crypto'

import {
  EMAIL_VERIFICATIONS_COLLECTION,
  OCR_REGISTRATION_COLLECTION,
  REGISTRATION_ACCESS_COLLECTION
} from '#/common/constants/collections.js'
import { addSeconds } from '#/common/helpers/time.js'
import { hashLinkToken } from '#/services/email-verification/link-token.js'
import { STATUS } from '#/services/email-verification/verification-records.js'
import {
  CONTACT_EMAIL,
  JOURNEY,
  JOURNEY_SECRET,
  journeyToken,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'

const HASH_SECRET = 'hash-test-secret'
const EXTERNAL_SECRET = 'external-user-test-secret'
const SECONDS_PER_DAY = 86400

// Inserts a PENDING verification record with a known raw token (hashed, as the
// request-link flow would store it), so the real /email-verifications/verify
// route can be exercised end-to-end rather than stubbed.
async function seedPendingVerification(
  db,
  { journeyId = JOURNEY, email = CONTACT_EMAIL } = {}
) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  await db.collection(EMAIL_VERIFICATIONS_COLLECTION).insertOne({
    journeyId,
    email,
    tokenHash: hashLinkToken(token),
    status: STATUS.PENDING,
    createdAt: now,
    expiresAt: addSeconds(now, 900),
    verifiedAt: null,
    supersededAt: null,
    purgeAt: addSeconds(now, SECONDS_PER_DAY)
  })
  return token
}

describe('External user RBAC: end-to-end flow', () => {
  let server
  let config
  let registrations
  let originalSettings
  let originalJourneySecret
  let originalExternalSecret

  beforeAll(async () => {
    const [{ createServer }, configModule] = await Promise.all([
      import('#/server.js'),
      import('#/config.js')
    ])
    config = configModule.config
    originalSettings = structuredClone(config.get('emailVerification'))
    originalJourneySecret = config.get('journeyToken.secret')
    originalExternalSecret = config.get('externalUser.tokenSecret')
    server = await createServer()
    await server.initialize()
    registrations = server.db.collection(OCR_REGISTRATION_COLLECTION)
  })

  beforeEach(() => {
    config.set('emailVerification', {
      ...structuredClone(originalSettings),
      hashSecret: HASH_SECRET,
      linkBaseUrl: 'https://ocr.example.gov.uk',
      requiredForRegistration: false
    })
    config.set('journeyToken.secret', JOURNEY_SECRET)
    config.set('externalUser.tokenSecret', EXTERNAL_SECRET)
  })

  afterEach(async () => {
    config.set('emailVerification', originalSettings)
    config.set('journeyToken.secret', originalJourneySecret)
    config.set('externalUser.tokenSecret', originalExternalSecret)
    await server.db.collection(EMAIL_VERIFICATIONS_COLLECTION).deleteMany({})
    await server.db.collection(REGISTRATION_ACCESS_COLLECTION).deleteMany({})
    await registrations.deleteMany({})
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function submitRegistration() {
    const response = await server.inject({
      method: 'POST',
      url: '/register',
      payload: validRegistrationPayload
    })
    expect(response.statusCode).toBe(201)
    return JSON.parse(response.payload).reference
  }

  async function verifyForReference(reference) {
    const token = await seedPendingVerification(server.db)
    const response = await server.inject({
      method: 'POST',
      url: '/email-verifications/verify',
      headers: { 'x-journey-token': journeyToken(JOURNEY) },
      payload: { token, reference }
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.externalAccessToken).toBeTypeOf('string')
    return body.externalAccessToken
  }

  test('full flow: register, verify for the reference, view and edit own registration', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect(getResponse.statusCode).toBe(200)
    expect(JSON.parse(getResponse.payload)).toMatchObject({
      reference,
      businessName: 'Company 1'
    })

    const patchResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessName: 'Updated Company Name' }
    })
    expect(patchResponse.statusCode).toBe(200)
    expect(JSON.parse(patchResponse.payload)).toMatchObject({
      businessName: 'Updated Company Name',
      version: 2
    })
  })

  test('cross-record access is denied with no data leakage', async () => {
    const ownReference = await submitRegistration()
    const otherReference = await submitRegistration()
    const accessToken = await verifyForReference(ownReference)

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${otherReference}`,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect(getResponse.statusCode).toBe(403)
    expect(getResponse.payload).not.toContain('businessName')
    expect(getResponse.payload).not.toContain(otherReference)

    const patchResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${otherReference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessName: 'Hijacked' }
    })
    expect(patchResponse.statusCode).toBe(403)
  })

  test('no token at all is rejected with 401', async () => {
    const reference = await submitRegistration()

    const response = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`
    })
    expect(response.statusCode).toBe(401)
  })

  test('an expired/invalid token is rejected with 401, not 403', async () => {
    const reference = await submitRegistration()

    const response = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`,
      headers: { authorization: 'Bearer not-a-real-token' }
    })
    expect(response.statusCode).toBe(401)
  })

  test('an external-user token cannot reach internal-only routes', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    const response = await server.inject({
      method: 'GET',
      url: '/search?reference=' + reference,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect([401, 403, 404]).toContain(response.statusCode)
  })

  // AC6 (completion ticket, default decision): changing the contact email
  // revokes every existing grant on the registration, so a token issued
  // before the change stops working immediately, and the applicant must
  // re-verify (as the new email) to regain access.
  test('changing the contact email revokes existing access; the old token stops working', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    const patchResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        version: 1,
        primaryContact: {
          contactName: 'Jonny Pesticide',
          contactTelephone: '01234567890',
          contactEmail: 'new-address@example.com'
        }
      }
    })
    expect(patchResponse.statusCode).toBe(200)

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect(getResponse.statusCode).toBe(403)
  })
})
