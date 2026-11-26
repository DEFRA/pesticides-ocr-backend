import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'

import {
  JOURNEY,
  JOURNEY_SECRET,
  journeyToken,
  seedVerification,
  validRegistrationPayload
} from '#/routes/registration/registration.fixtures.js'
import {
  BUSINESS_ACTIVITY,
  PROFESSIONAL_SECTOR,
  STORING,
  WHO_APPLIES
} from '#/common/constants/registration-answers.js'

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

  const withUsingPPPs = (changes, ...omit) => {
    const usingPPPs = { ...validPayload.usingPPPs, ...changes }
    omit.forEach((key) => delete usingPPPs[key])
    return { ...validPayload, usingPPPs }
  }

  const messageOf = (response) => JSON.parse(response.payload).message

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
          businessActivities: [
            BUSINESS_ACTIVITY.USING,
            BUSINESS_ACTIVITY.SELLING
          ],
          usingPPPs: validPayload.usingPPPs
        }),
        { requestId: 'request-1' }
      )
    })

    test('accepts payload without optional fields', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-MIN-001' })

      const { addressLine2, addressCounty, ...address } = validPayload.address
      const { contactJobTitle, ...primaryContact } = validPayload.primaryContact

      const response = await postRegister({
        ...validPayload,
        address,
        primaryContact
      })

      expect(response.statusCode).toBe(201)
    })

    test('accepts an address outside Great Britain', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-INT-001' })

      const response = await postRegister({
        ...validPayload,
        address: { internationalAddress: 'Rue de la Paix 12\n75002 Paris' }
      })

      expect(response.statusCode).toBe(201)
    })
  })

  describe('answers that depend on earlier answers', () => {
    function post(payload) {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-SKP-001' })

      return postRegister(payload)
    }

    test('accepts no usingPPPs when using PPPs is not ticked', async () => {
      const { usingPPPs, ...rest } = validPayload

      const response = await post({
        ...rest,
        businessActivities: [BUSINESS_ACTIVITY.SELLING]
      })

      expect(response.statusCode).toBe(201)
    })

    test('returns 400 with no usingPPPs when using PPPs is ticked', async () => {
      const { usingPPPs, ...rest } = validPayload

      const response = await post(rest)

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toBe('"usingPPPs" is required')
    })

    test('accepts no contractor when the organisation applies PPPs itself', async () => {
      const response = await post(
        withUsingPPPs({ whoApplies: WHO_APPLIES.SELF }, 'contractor')
      )

      expect(response.statusCode).toBe(201)
    })

    test.each([
      ['a contractor is missing', withUsingPPPs({}, 'contractor')],
      [
        'agricultural sub-sectors are missing',
        withUsingPPPs({}, 'agriSubsectors')
      ],
      [
        'storage addresses are missing',
        withUsingPPPs({}, 'ownStorageAddresses')
      ],
      ['a storage contact is missing', withUsingPPPs({}, 'storageContact')],
      ['the quantity is missing', withUsingPPPs({}, 'quantity')]
    ])('returns 400 when %s', async (_, payload) => {
      const response = await post(payload)

      expect(response.statusCode).toBe(400)
    })

    test.each([
      [
        'a contractor when the organisation applies PPPs itself',
        withUsingPPPs({ whoApplies: WHO_APPLIES.SELF }),
        '"usingPPPs.contractor" is not allowed'
      ],
      [
        'horticultural sub-sectors when horticulture is not ticked',
        withUsingPPPs({ hortiSubsectors: ['orchards'] }),
        '"usingPPPs.hortiSubsectors" is not allowed'
      ],
      [
        'member schemes when amenity is the only sector with sub-sectors',
        withUsingPPPs(
          { professionalSectors: [PROFESSIONAL_SECTOR.AMENITY] },
          'agriSubsectors'
        ),
        '"usingPPPs.memberSchemes" is not allowed'
      ],
      [
        'a storage location when nothing is stored',
        withUsingPPPs(
          { storing: [STORING.NONE] },
          'ownStorageAddresses',
          'storageContact'
        ),
        '"usingPPPs.storageLocation" is not allowed'
      ]
    ])('returns 400 for %s', async (_, payload, message) => {
      const response = await post(payload)

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toContain(message)
    })

    test('accepts no member schemes when amenity is the only sector with sub-sectors', async () => {
      const response = await post(
        withUsingPPPs(
          { professionalSectors: [PROFESSIONAL_SECTOR.AMENITY] },
          'agriSubsectors',
          'memberSchemes'
        )
      )

      expect(response.statusCode).toBe(201)
    })

    test('accepts an empty list of member schemes', async () => {
      const response = await post(withUsingPPPs({ memberSchemes: [] }))

      expect(response.statusCode).toBe(201)
    })

    test('accepts nothing stored, with no storage answers', async () => {
      const response = await post(
        withUsingPPPs(
          { storing: [STORING.NONE] },
          'storageLocation',
          'ownStorageAddresses',
          'storageContact'
        )
      )

      expect(response.statusCode).toBe(201)
    })

    test('saves the Other description, trimmed, after the ticked sectors', async () => {
      const response = await post(
        withUsingPPPs(
          { professionalSectors: [PROFESSIONAL_SECTOR.FORESTRY, '  Golf  '] },
          'agriSubsectors',
          'amenitySubsectors'
        )
      )

      expect(response.statusCode).toBe(201)
      expect(mockSaveRegistration).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          usingPPPs: expect.objectContaining({
            professionalSectors: [PROFESSIONAL_SECTOR.FORESTRY, 'Golf']
          })
        }),
        expect.anything()
      )
    })
  })

  describe('service errors', () => {
    test('returns 500 when saveRegistration throws', async () => {
      mockSaveRegistration.mockRejectedValue(new Error('db connection lost'))

      const response = await postRegister(validPayload)

      expect(response.statusCode).toBe(500)
      expect(messageOf(response)).toBe('An internal server error occurred')
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
      expect(messageOf(response)).toMatch(/business activity/i)
    })

    test('returns 400 when businessName is missing', async () => {
      const { businessName, ...rest } = validPayload

      const response = await postRegister(rest)

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toMatch(/business name/i)
    })

    test('returns 400 for an answer the journey no longer asks', async () => {
      const response = await postRegister({
        ...validPayload,
        mainCustomer: 'professional'
      })

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toBe('"mainCustomer" is not allowed')
    })

    test('returns 400 for invalid UK postcode', async () => {
      const response = await postRegister({
        ...validPayload,
        address: { ...validPayload.address, addressPostcode: 'NOTVALID' }
      })

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toMatch(/postcode/i)
    })

    test('returns 400 when the address region is missing', async () => {
      const { addressRegion, ...address } = validPayload.address

      const response = await postRegister({ ...validPayload, address })

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toBe('Select a country')
    })

    test.each([
      ['empty', '   ', 'Enter your main business address'],
      [
        'over 500 characters',
        'x'.repeat(501),
        'Business address must be 500 characters or less'
      ]
    ])(
      'returns 400 for an address outside Great Britain that is %s',
      async (_, internationalAddress, message) => {
        const response = await postRegister({
          ...validPayload,
          address: { internationalAddress }
        })

        expect(response.statusCode).toBe(400)
        expect(messageOf(response)).toBe(message)
      }
    )

    test('returns 400 for invalid email address', async () => {
      const response = await postRegister({
        ...validPayload,
        primaryContact: {
          ...validPayload.primaryContact,
          contactEmail: 'not-an-email'
        }
      })

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toMatch(/email/i)
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
      expect(messageOf(response)).toMatch(/telephone/i)
    })

    test.each([
      ['an unknown band', '1000-plus'],
      ['the old shape', { quantityType: 'area', quantity: 10 }]
    ])('returns 400 for a quantity that is %s', async (_, quantity) => {
      const response = await postRegister(withUsingPPPs({ quantity }))

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toMatch(/quantity/i)
    })

    test('returns 400 for invalid businessActivity value', async () => {
      const response = await postRegister({
        ...validPayload,
        businessActivities: ['invalid-activity']
      })

      expect(response.statusCode).toBe(400)
    })

    test.each([
      [
        'two Other descriptions',
        [PROFESSIONAL_SECTOR.FORESTRY, 'Golf', 'Parks']
      ],
      ['a blank Other description', ['   ']],
      ['an Other description over 100 characters', ['x'.repeat(101)]],
      [
        'a repeated sector code',
        [PROFESSIONAL_SECTOR.FORESTRY, PROFESSIONAL_SECTOR.FORESTRY]
      ],
      ['no answers', []],
      ['a string instead of a list', 'Golf courses'],
      ['null', null]
    ])('returns 400 for professionalSectors with %s', async (_, sectors) => {
      const response = await postRegister(
        withUsingPPPs(
          { professionalSectors: sectors },
          'agriSubsectors',
          'amenitySubsectors'
        )
      )

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 when not storing PPPs is ticked with where they are stored', async () => {
      const response = await postRegister(
        withUsingPPPs({ storing: [STORING.NONE, STORING.OWN] })
      )

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toContain(
        "Select where the products are stored, or select 'We do not store PPPs'"
      )
    })

    test('returns 400 when a storage address has no town', async () => {
      const response = await postRegister(
        withUsingPPPs({
          ownStorageAddresses: [
            {
              addressLine1: '1 Other St',
              addressPostcode: 'SW1A 2AA',
              addressRegion: 'england'
            }
          ]
        })
      )

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toBe('Enter town or city')
    })

    test('returns 400 when the storage contact has no business name', async () => {
      const { businessName, ...storageContact } =
        validPayload.usingPPPs.storageContact

      const response = await postRegister(withUsingPPPs({ storageContact }))

      expect(response.statusCode).toBe(400)
      expect(messageOf(response)).toBe('Enter the business name')
    })
  })
})
