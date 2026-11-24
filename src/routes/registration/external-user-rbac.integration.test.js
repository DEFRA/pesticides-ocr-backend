import { randomBytes } from 'node:crypto'

import { SignJWT } from 'jose'

import {
  EMAIL_VERIFICATIONS_COLLECTION,
  OCR_REGISTRATION_COLLECTION,
  REGISTRATION_ACCESS_COLLECTION
} from '#/common/constants/collections.js'
import { addSeconds } from '#/common/helpers/time.js'
import { getCaseOfficerRoles } from '#/auth/require-role.js'
import { createRegistrationAccessRepository } from '#/repositories/registration-access.js'
import { issueExternalAccessToken } from '#/services/external-user/access-token.js'
import { hashLinkToken } from '#/services/email-verification/link-token.js'
import { STATUS } from '#/services/email-verification/verification-records.js'
import {
  CONTACT_EMAIL,
  JOURNEY,
  JOURNEY_SECRET,
  journeyToken,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'

const OFFICER_SUBJECT = 'officer-1'

// The API runs in mock auth mode under test (ENVIRONMENT defaults to local),
// so tokens are decoded but not signature-verified.
function mockOfficerToken() {
  return new SignJWT({ name: 'Test Officer', roles: getCaseOfficerRoles() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(OFFICER_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

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

  async function submitRegistration(payload = validRegistrationPayload) {
    const response = await server.inject({
      method: 'POST',
      url: '/register',
      payload
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

  // Shared route: a case officer (entra-bearer) can also reach GET/PATCH, via
  // requireSharedAccess + authorise()'s internal branch (requireInternalPermission).
  test('a case officer can view and edit a registration via the shared route', async () => {
    const reference = await submitRegistration()
    const officerToken = await mockOfficerToken()

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${officerToken}` }
    })
    expect(getResponse.statusCode).toBe(200)
    expect(JSON.parse(getResponse.payload)).toMatchObject({ reference })

    const patchResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${officerToken}` },
      payload: { version: 1, businessName: 'Officer Updated Name' }
    })
    expect(patchResponse.statusCode).toBe(200)
    expect(JSON.parse(patchResponse.payload)).toMatchObject({
      businessName: 'Officer Updated Name',
      version: 2
    })
  })

  // PATCH with a stale `version` must return 409, not silently overwrite.
  test('PATCH with a stale version returns 409 Conflict', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    // Advance the registration to version 2 first.
    const firstPatch = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessName: 'First Update' }
    })
    expect(firstPatch.statusCode).toBe(200)

    // Retry with the now-stale version 1.
    const staleResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessName: 'Stale Update' }
    })
    expect(staleResponse.statusCode).toBe(409)
  })

  // Editing other contact details, or re-sending the same email (even with
  // different casing/whitespace), is not a contact-email change, so it must
  // not revoke access.
  test('editing the contact phone number, or the same email re-cased, keeps access', async () => {
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
          contactTelephone: '07700900123',
          contactEmail: `  ${CONTACT_EMAIL.toUpperCase()}  `
        }
      }
    })
    expect(patchResponse.statusCode).toBe(200)

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect(getResponse.statusCode).toBe(200)
  })

  // PATCH must leave a record POST /register would have accepted: the
  // changes are merged into the stored record and the result validated
  // against the full schema, so cross-field rules still apply.
  test('PATCH rejects a change that breaks a cross-field rule (mainCustomer)', async () => {
    const { mainCustomer: _omitted, ...withoutMainCustomer } =
      validRegistrationPayload
    const reference = await submitRegistration({
      ...withoutMainCustomer,
      businessActivities: ['seller-amateur']
    })
    const accessToken = await verifyForReference(reference)

    const response = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessActivities: ['manufacture'] }
    })
    expect(response.statusCode).toBe(400)
  })

  test('PATCH rejects a change that breaks a cross-field rule (quantity)', async () => {
    const { quantity: _omitted, ...withoutQuantity } = validRegistrationPayload
    const reference = await submitRegistration({
      ...withoutQuantity,
      addressActivities: ['store']
    })
    const accessToken = await verifyForReference(reference)

    const response = await server.inject({
      method: 'PATCH',
      url: `/registrations/${reference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, addressActivities: ['use', 'store'] }
    })
    expect(response.statusCode).toBe(400)
  })

  // A grant can outlive the registration it names (e.g. deleted or never
  // created) — this should be an internal-inconsistency 404, not a leak.
  test('GET/PATCH return 404 when the token is valid but the registration no longer exists', async () => {
    const missingReference = 'PPP-ZZZ-999'
    const subject = 'missing-reg-subject'
    const accessRepository = createRegistrationAccessRepository({
      db: server.db
    })
    const future = new Date(Date.now() + 30 * 60 * 1000)
    await accessRepository.grant({
      subject,
      reference: missingReference,
      expiresAt: future
    })
    const accessToken = await issueExternalAccessToken({
      subject,
      reference: missingReference
    })

    const getResponse = await server.inject({
      method: 'GET',
      url: `/registrations/${missingReference}`,
      headers: { authorization: `Bearer ${accessToken}` }
    })
    expect(getResponse.statusCode).toBe(404)

    const patchResponse = await server.inject({
      method: 'PATCH',
      url: `/registrations/${missingReference}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: 1, businessName: 'Nope' }
    })
    expect(patchResponse.statusCode).toBe(404)
  })

  // Any error from the transaction that isn't a VersionConflictError or a
  // Boom must be logged and surfaced as a generic 500, never leak internals
  // to the caller.
  test('PATCH returns 500 for an unexpected error from the transaction', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    const original = server.registrations.withTransaction
    server.registrations.withTransaction = vi
      .fn()
      .mockRejectedValue(new Error('unexpected database failure'))

    try {
      const response = await server.inject({
        method: 'PATCH',
        url: `/registrations/${reference}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { version: 1, businessName: 'Should Fail' }
      })
      expect(response.statusCode).toBe(500)
    } finally {
      server.registrations.withTransaction = original
    }
  })

  // A TypeError from the repository layer (e.g. a guard assertion, or a
  // genuine bug such as reading a property of undefined) indicates a server
  // fault, not a bad caller input — the Joi schema (including .min(2)) has
  // already rejected malformed/empty payloads by this point. It must be
  // logged and surfaced as a generic 500, not mapped to 400, so it is never
  // hidden as a client error or leak an internal message to the caller.
  test('PATCH returns 500 when the transaction throws a TypeError', async () => {
    const reference = await submitRegistration()
    const accessToken = await verifyForReference(reference)

    const original = server.registrations.withTransaction
    server.registrations.withTransaction = vi
      .fn()
      .mockRejectedValue(new TypeError('bad input shape'))

    try {
      const response = await server.inject({
        method: 'PATCH',
        url: `/registrations/${reference}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { version: 1, businessName: 'Should Fail' }
      })
      expect(response.statusCode).toBe(500)
    } finally {
      server.registrations.withTransaction = original
    }
  })
})
