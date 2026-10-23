import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'

import {
  JOURNEY,
  JOURNEY_SECRET,
  journeyToken,
  seedVerification,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'

const mockSaveRegistration = vi.fn()

vi.mock('#/services/registration/registration.js', () => ({
  saveRegistration: mockSaveRegistration
}))

// The email verification gate itself is covered against the real records in
// registration-email-verification.test.js. Here the contact email is verified
// for the journey, so every request reaches validation and saving as before.
describe('POST /register', () => {
  let server
  let config
  let originalJourneySecret

  beforeAll(async () => {
    const [{ createServer }, configModule] = await Promise.all([
      import('#/server.js'),
      import('#/config.js')
    ])
    config = configModule.config
    originalJourneySecret = config.get('journeyToken.secret')
    config.set('journeyToken.secret', JOURNEY_SECRET)
    server = await createServer()
    await server.initialize()
    await seedVerification(server.db)
  })

  afterAll(async () => {
    config.set('journeyToken.secret', originalJourneySecret)
    await server.stop({ timeout: 1000 })
  })

  const postRegister = (payload) =>
    server.inject({
      method: 'POST',
      url: '/register',
      headers: { 'x-journey-token': journeyToken(JOURNEY) },
      payload
    })

  const validPayload = validRegistrationPayload

  describe('success', () => {
    test('returns 201 and reference on valid payload', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-ABC-123' })

      const response = await postRegister(validPayload)

      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.payload)).toEqual({ reference: 'PP-ABC-123' })
    })

    test('saves the registration data', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-XYZ-789' })

      await server.inject({
        method: 'POST',
        url: '/register',
        headers: { [config.get('tracing.header')]: 'request-1' },
        payload: validPayload
      })
      await postRegister(validPayload)

      expect(mockSaveRegistration).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          businessName: 'Company 1',
          businessActivities: ['manufacture', 'market']
        }),
        { requestId: 'request-1' }
      )
    })

    test('accepts payload without optional fields', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-MIN-001' })

      const {
        professionalSectors,
        memberSchemes,
        additionalAddresses,
        ...rest
      } = validPayload

      const response = await postRegister(rest)

      expect(response.statusCode).toBe(201)
    })
  })

  describe('service errors', () => {
    test('returns 500 when saveRegistration throws', async () => {
      mockSaveRegistration.mockRejectedValue(new Error('db connection lost'))

      const response = await postRegister(validPayload)

      expect(response.statusCode).toBe(500)
      expect(JSON.parse(response.payload).message).toBe(
        'An internal server error occurred'
      )
    })
  })

  describe('validation failures', () => {
    test('returns 400 when the payload is empty', async () => {
      const response = await postRegister({})

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when the payload is wrapped in formSession', async () => {
      const response = await postRegister({ formSession: validPayload })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when businessActivities is empty', async () => {
      const response = await postRegister({
        ...validPayload,
        businessActivities: []
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business activity/i)
    })

    test('returns 400 when businessName is missing', async () => {
      const { businessName, ...rest } = validPayload

      const response = await postRegister(rest)

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business name/i)
    })

    test('returns 400 when mainCustomer is missing', async () => {
      const { mainCustomer, ...rest } = validPayload

      const response = await postRegister(rest)

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/main customer/i)
    })

    test('returns 400 for invalid UK postcode', async () => {
      const response = await postRegister({
        ...validPayload,
        address: { ...validPayload.address, addressPostcode: 'NOTVALID' }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/postcode/i)
    })

    test('returns 400 for invalid email address', async () => {
      const response = await postRegister({
        ...validPayload,
        primaryContact: {
          ...validPayload.primaryContact,
          contactEmail: 'not-an-email'
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/email/i)
    })

    test('returns 400 for invalid telephone number', async () => {
      const response = await postRegister({
        ...validPayload,
        primaryContact: {
          ...validPayload.primaryContact,
          contactTelephone: 'abc'
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/telephone/i)
    })

    test('returns 400 for invalid quantityType', async () => {
      const response = await postRegister({
        ...validPayload,
        quantity: { quantityType: 'volume', quantity: '10' }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/quantity type/i)
    })

    test('returns 400 for non-numeric quantity value', async () => {
      const response = await postRegister({
        ...validPayload,
        quantity: { quantityType: 'area', quantity: 'lots' }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/quantity/i)
    })

    test('returns 400 for invalid businessActivity value', async () => {
      const response = await postRegister({
        ...validPayload,
        businessActivities: ['invalid-activity']
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 for invalid professionalSectors value', async () => {
      const response = await postRegister({
        ...validPayload,
        professionalSectors: ['invalid-sector']
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when additional address has missing contact', async () => {
      const response = await postRegister({
        ...validPayload,
        additionalAddresses: [
          {
            address: {
              addressLine1: '1 Other St',
              addressTown: 'Othertown',
              addressPostcode: 'SW1A 2AA'
            },
            activity: ['use']
          }
        ]
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
