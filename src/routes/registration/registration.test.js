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
  QUANTITY_BAND,
  STORING
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
          businessActivities: ['using', 'selling']
        }),
        { requestId: 'request-1' }
      )
    })

    test.each([['england'], ['scotland'], ['wales']])(
      'accepts %s as the main address region',
      async (addressRegion) => {
        mockSaveRegistration.mockResolvedValue({ reference: 'PP-REG-001' })

        const response = await postRegister({
          ...validPayload,
          address: { ...validPayload.address, addressRegion }
        })

        expect(response.statusCode).toBe(201)
      }
    )

    test('saves the contact job title trimmed, and accepts it empty', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-JOB-001' })

      const [trimmed, empty] = await Promise.all(
        ['  Farm manager  ', ''].map((contactJobTitle) =>
          postRegister({
            ...validPayload,
            primaryContact: { ...validPayload.primaryContact, contactJobTitle }
          })
        )
      )

      expect(trimmed.statusCode).toBe(201)
      expect(empty.statusCode).toBe(201)
      expect(mockSaveRegistration).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          primaryContact: expect.objectContaining({
            contactJobTitle: 'Farm manager'
          })
        }),
        expect.anything()
      )
    })

    test('accepts payload without optional fields', async () => {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-MIN-001' })

      const { usingPPPs, additionalAddresses, ...rest } = validPayload

      const response = await postRegister(rest)

      expect(response.statusCode).toBe(201)
    })
  })

  describe('answers that depend on earlier answers', () => {
    function post(payload) {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-SKP-001' })

      return postRegister(payload)
    }

    test('accepts only storing on its own', async () => {
      const response = await post({
        ...validPayload,
        businessActivities: [BUSINESS_ACTIVITY.ONLY_STORING]
      })

      expect(response.statusCode).toBe(201)
    })

    test.each([
      [[BUSINESS_ACTIVITY.ONLY_STORING, BUSINESS_ACTIVITY.USING]],
      [[BUSINESS_ACTIVITY.SELLING, BUSINESS_ACTIVITY.ONLY_STORING]]
    ])(
      'returns 400 when only storing is sent with another activity: %j',
      async (businessActivities) => {
        const response = await post({ ...validPayload, businessActivities })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.payload).message).toBe(
          "Select either your activities or 'Only storing PPPs for other businesses'"
        )
      }
    )

    test('accepts an additional address without a region', async () => {
      const [additional] = validPayload.additionalAddresses
      const { addressRegion, ...address } = additional.address

      const response = await post({
        ...validPayload,
        additionalAddresses: [{ ...additional, address }]
      })

      expect(response.statusCode).toBe(201)
    })

    test('still validates a region sent on an additional address', async () => {
      const [additional] = validPayload.additionalAddresses

      const response = await post({
        ...validPayload,
        additionalAddresses: [
          {
            ...additional,
            address: { ...additional.address, addressRegion: 'ireland' }
          }
        ]
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe('Select a country')
    })

    test('accepts no addressActivities when the activities include using', async () => {
      const { addressActivities, ...rest } = validPayload

      const response = await post({
        ...rest,
        businessActivities: [BUSINESS_ACTIVITY.USING]
      })

      expect(response.statusCode).toBe(201)
    })

    test('returns 400 with no addressActivities when the activities have no using', async () => {
      const { addressActivities, ...rest } = validPayload

      const response = await post({
        ...rest,
        businessActivities: [BUSINESS_ACTIVITY.SELLING]
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe(
        'Select at least one address activity'
      )
    })
  })

  describe('Using PPPs answers', () => {
    function postUsing(usingPPPs) {
      mockSaveRegistration.mockResolvedValue({ reference: 'PP-USE-001' })

      return postRegister({ ...validPayload, usingPPPs })
    }

    test('saves the usingPPPs answers', async () => {
      const response = await postUsing(validPayload.usingPPPs)

      expect(response.statusCode).toBe(201)
      expect(mockSaveRegistration).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ usingPPPs: validPayload.usingPPPs }),
        expect.anything()
      )
    })

    test.each([
      ['no answers', {}],
      ['only who applies', { whoApplies: 'self' }],
      ['only storing', { storing: STORING.NO }],
      [
        'an own storage address and location',
        {
          storing: STORING.OWN,
          storageLocation: 'main-and-other',
          ownStorageAddress: {
            addressLine1: '3 Barn Lane',
            addressTown: 'Barnton',
            addressPostcode: 'LS1 1AA',
            addressRegion: 'england'
          }
        }
      ],
      ['skipped member schemes', { memberSchemes: [] }]
    ])('accepts usingPPPs with %s', async (_, usingPPPs) => {
      const response = await postUsing(usingPPPs)

      expect(response.statusCode).toBe(201)
    })

    test.each([
      ['professionalSectors'],
      ['agriSubsectors'],
      ['amenitySubsectors'],
      ['hortiSubsectors']
    ])('saves an Other description, trimmed, as the only %s', async (field) => {
      const response = await postUsing({ [field]: ['  Golf courses  '] })

      expect(response.statusCode).toBe(201)
      expect(mockSaveRegistration).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          usingPPPs: { [field]: ['Golf courses'] }
        }),
        expect.anything()
      )
    })

    test.each([
      [
        'a sector code with an Other description',
        [PROFESSIONAL_SECTOR.AMENITY, 'Golf courses']
      ],
      ['two Other descriptions', ['Golf courses', 'Parks']],
      ['a blank Other description', ['   ']],
      ['an Other description over 100 characters', ['x'.repeat(101)]],
      [
        'a repeated sector code',
        [PROFESSIONAL_SECTOR.AMENITY, PROFESSIONAL_SECTOR.AMENITY]
      ],
      ['an old sector code', ['agriculture-horticulture', 'Golf courses']],
      ['a string instead of a list', 'Golf courses'],
      ['null', null]
    ])('returns 400 for professionalSectors with %s', async (_, sectors) => {
      const response = await postUsing({ professionalSectors: sectors })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe(
        'Select a sector or describe your main type of work'
      )
    })

    test('returns 400 for a subsector from another sector', async () => {
      const response = await postUsing({ agriSubsectors: ['parks', 'arable'] })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe(
        'Select an agricultural sector or describe your main type of work'
      )
    })

    test.each(Object.values(QUANTITY_BAND))(
      'accepts the quantity band %s',
      async (quantity) => {
        const response = await postUsing({ quantity })

        expect(response.statusCode).toBe(201)
      }
    )

    test.each([
      ['an unknown band', '1-100'],
      ['a number', 50],
      ['the old quantity object', { quantityType: 'area', quantity: '67' }],
      ['an empty string', '']
    ])('returns 400 for a quantity that is %s', async (_, quantity) => {
      const response = await postUsing({ quantity })

      expect(response.statusCode).toBe(400)
    })

    test.each([
      ['whoApplies', 'someone'],
      ['storing', 'yes'],
      ['storageLocation', 'elsewhere']
    ])('returns 400 for an unknown %s', async (field, value) => {
      const response = await postUsing({ [field]: value })

      expect(response.statusCode).toBe(400)
    })

    test.each([
      ['no contractorName', 'address'],
      ['no address', 'contractorName']
    ])('returns 400 for a contractor with %s', async (_, keep) => {
      const { contractor } = validPayload.usingPPPs

      const response = await postUsing({
        whoApplies: 'contractor',
        contractor: { [keep]: contractor[keep] }
      })

      expect(response.statusCode).toBe(400)
    })

    test('returns 400 for a storage contact with no business name', async () => {
      const { businessName, ...storageContact } =
        validPayload.usingPPPs.storageContact

      const response = await postUsing({
        storing: STORING.THIRD_PARTY,
        storageContact
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe('Enter a business name')
    })

    test('returns 400 for an unknown usingPPPs field', async () => {
      const response = await postUsing({ favouriteProduct: 'glyphosate' })

      expect(response.statusCode).toBe(400)
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

    test('returns 400 when mainCustomer is sent', async () => {
      const response = await postRegister({
        ...validPayload,
        mainCustomer: 'professional'
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe(
        '"mainCustomer" is not allowed'
      )
    })

    test('returns 400 when the main address has no region', async () => {
      const { addressRegion, ...address } = validPayload.address

      const response = await postRegister({ ...validPayload, address })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe('Select a country')
    })

    test.each([['ireland'], ['England'], ['']])(
      'returns 400 when the main address region is %j',
      async (addressRegion) => {
        const response = await postRegister({
          ...validPayload,
          address: { ...validPayload.address, addressRegion }
        })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.payload).message).toBe('Select a country')
      }
    )

    test('returns 400 when contactJobTitle is over 100 characters', async () => {
      const response = await postRegister({
        ...validPayload,
        primaryContact: {
          ...validPayload.primaryContact,
          contactJobTitle: 'x'.repeat(101)
        }
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toBe(
        'Job title or role must be 100 characters or less'
      )
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

    test('returns 400 for invalid businessActivity value', async () => {
      const response = await postRegister({
        ...validPayload,
        businessActivities: ['invalid-activity']
      })

      expect(response.statusCode).toBe(400)
    })

    test.each([['quantity'], ['professionalSectors'], ['memberSchemes']])(
      'returns 400 for the old top-level %s field',
      async (field) => {
        const response = await postRegister({
          ...validPayload,
          [field]: validPayload.usingPPPs[field]
        })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.payload).message).toBe(
          `"${field}" is not allowed`
        )
      }
    )

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
