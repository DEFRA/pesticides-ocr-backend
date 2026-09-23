import { describe, test, expect, vi, beforeAll } from 'vitest'

const mockSaveRegistration = vi.fn()

vi.mock('#/services/registration/registration.js', () => ({
  saveRegistration: mockSaveRegistration
}))

describe('POST /register', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 1000 })
  })

  const validPayload = {
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
      contactEmail: 'spray@everything.biz'
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

  describe('success', () => {
    test('returns 201 and reference on valid payload', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-ABC-123' })

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: validPayload
      })

      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.payload)).toEqual({ reference: 'PP-ABC-123' })
    })

    test('saves the registration data', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-XYZ-789' })

      await server.inject({
        method: 'POST',
        url: '/register',
        payload: validPayload
      })

      expect(mockSaveRegistration).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          businessName: 'Company 1',
          businessActivities: ['manufacture', 'market']
        })
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

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: rest
      })

      expect(response.statusCode).toBe(201)
    })
  })

  describe('service errors', () => {
    test('returns 500 when saveRegistration throws', async () => {
      mockSaveRegistration.mockRejectedValue(new Error('db connection lost'))

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: validPayload
      })

      expect(response.statusCode).toBe(500)
      expect(JSON.parse(response.payload).message).toBe(
        'An internal server error occurred'
      )
    })
  })

  describe('validation failures', () => {
    test('returns 400 when the payload is empty', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {}
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when the payload is wrapped in formSession', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { formSession: validPayload }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when businessActivities is empty', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { ...validPayload, businessActivities: [] }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business activity/i)
    })

    test('returns 400 when businessName is missing', async () => {
      const { businessName, ...rest } = validPayload

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: rest
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business name/i)
    })

    test('returns 400 when mainCustomer is missing', async () => {
      const { mainCustomer, ...rest } = validPayload

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: rest
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/main customer/i)
    })

    test('returns 400 for invalid UK postcode', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          ...validPayload,
          address: { ...validPayload.address, addressPostcode: 'NOTVALID' }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/postcode/i)
    })

    test('returns 400 for invalid email address', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          ...validPayload,
          primaryContact: {
            ...validPayload.primaryContact,
            contactEmail: 'not-an-email'
          }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/email/i)
    })

    test('returns 400 for invalid telephone number', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          ...validPayload,
          primaryContact: {
            ...validPayload.primaryContact,
            contactTelephone: 'abc'
          }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/telephone/i)
    })

    test('returns 400 for invalid quantityType', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          ...validPayload,
          quantity: { quantityType: 'volume', quantity: '10' }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/quantity type/i)
    })

    test('returns 400 for non-numeric quantity value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          ...validPayload,
          quantity: { quantityType: 'area', quantity: 'lots' }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/quantity/i)
    })

    test('returns 400 for invalid businessActivity value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { ...validPayload, businessActivities: ['invalid-activity'] }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 for invalid professionalSectors value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { ...validPayload, professionalSectors: ['invalid-sector'] }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when additional address has missing contact', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
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
        }
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
