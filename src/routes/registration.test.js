import { describe, test, expect, vi, beforeAll } from 'vitest'

const mockSaveRegistration = vi.fn()

vi.mock('#/services/registration.js', () => ({
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
    formSession: {
      businessActivities: ['manufacture', 'market'],
      businessName: 'Company 1',
      address: {
        line1: '67 My Road',
        line2: 'My Village',
        town: 'My Town',
        county: 'North Yorkshire',
        postcode: 'AB12 3CD'
      },
      primaryContact: {
        name: 'Jonny Pesticide',
        telephone: '01234567890',
        email: 'spray@everything.biz'
      },
      addressActivities: ['use', 'store'],
      quantity: { quantityType: 'area', quantity: '67' },
      professionalSectors: ['agriculture-horticulture', 'amenity'],
      memberSchemes: ['Scheme A'],
      additionalAddresses: [
        {
          address: {
            line1: '1 Other St',
            town: 'Othertown',
            postcode: 'SW1A 2AA'
          },
          contact: {
            name: 'Jane Doe',
            telephone: '07700900000',
            email: 'jane@example.com'
          },
          activity: ['use']
        }
      ]
    }
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

    test('saves the mapped formSession data', async () => {
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
      } = validPayload.formSession

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { formSession: rest }
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
    test('returns 400 when formSession is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {}
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when businessActivities is empty', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          formSession: { ...validPayload.formSession, businessActivities: [] }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business activity/i)
    })

    test('returns 400 when businessName is missing', async () => {
      const { businessName, ...rest } = validPayload.formSession

      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: { formSession: rest }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/business name/i)
    })

    test('returns 400 for invalid UK postcode', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          formSession: {
            ...validPayload.formSession,
            address: {
              ...validPayload.formSession.address,
              postcode: 'NOTVALID'
            }
          }
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
          formSession: {
            ...validPayload.formSession,
            primaryContact: {
              ...validPayload.formSession.primaryContact,
              email: 'not-an-email'
            }
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
          formSession: {
            ...validPayload.formSession,
            primaryContact: {
              ...validPayload.formSession.primaryContact,
              telephone: 'abc'
            }
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
          formSession: {
            ...validPayload.formSession,
            quantity: { quantityType: 'volume', quantity: '10' }
          }
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
          formSession: {
            ...validPayload.formSession,
            quantity: { quantityType: 'area', quantity: 'lots' }
          }
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toMatch(/quantity/i)
    })

    test('returns 400 for invalid businessActivity value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          formSession: {
            ...validPayload.formSession,
            businessActivities: ['invalid-activity']
          }
        }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 for invalid professionalSectors value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          formSession: {
            ...validPayload.formSession,
            professionalSectors: ['invalid-sector']
          }
        }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when additional address has missing contact', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        payload: {
          formSession: {
            ...validPayload.formSession,
            additionalAddresses: [
              {
                address: {
                  line1: '1 Other St',
                  town: 'Othertown',
                  postcode: 'SW1A 2AA'
                },
                activity: ['use']
              }
            ]
          }
        }
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
