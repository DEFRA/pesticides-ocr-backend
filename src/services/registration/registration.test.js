import { describe, test, expect, vi } from 'vitest'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import {
  saveRegistration,
  generateReference
} from '#/services/registration/registration.js'

const makeRegistrations = (create) => ({ create })
const savedRegistration = (create) => create.mock.calls[0][0]

describe('generateReference', () => {
  test('uses PPP prefix by default', () => {
    expect(generateReference()).toMatch(/^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('uses a custom prefix when provided', () => {
    expect(generateReference('SED')).toMatch(/^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })
})

describe('saveRegistration', () => {
  const validData = {
    businessName: 'Test Co',
    businessActivities: ['manufacture'],
    mainCustomer: 'professional',
    address: {
      addressLine1: '1 Test St',
      addressTown: 'Testville',
      addressPostcode: 'TE1 1ST'
    },
    primaryContact: {
      contactName: 'Test User',
      contactTelephone: '01234567890',
      contactEmail: 'test@test.com'
    },
    addressActivities: ['use'],
    quantity: { quantityType: 'area', quantity: '10' }
  }

  test('returns an PPP reference by default', async () => {
    const create = vi.fn().mockResolvedValue({})
    const result = await saveRegistration(makeRegistrations(create), validData)

    expect(result.reference).toMatch(/^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('uses a custom prefix when provided', async () => {
    const create = vi.fn().mockResolvedValue({})
    const result = await saveRegistration(
      makeRegistrations(create),
      validData,
      {
        prefix: 'SED'
      }
    )

    expect(result.reference).toMatch(/^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('creates the registration through the repository, with a submittedAt', async () => {
    const create = vi.fn().mockResolvedValue({})
    const { reference } = await saveRegistration(
      makeRegistrations(create),
      validData
    )

    expect(savedRegistration(create)).toEqual({
      ...validData,
      reference,
      submittedAt: expect.any(Date)
    })
  })

  test('records the change as made by an applicant, with the request ID', async () => {
    const create = vi.fn().mockResolvedValue({})
    await saveRegistration(makeRegistrations(create), validData, {
      requestId: 'request-1'
    })

    expect(create.mock.calls[0][1]).toEqual({
      by: { type: ACTOR_TYPE.APPLICANT },
      requestId: 'request-1'
    })
  })

  test('retries with a new reference on duplicate reference collision', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: MONGO_DUPLICATE_KEY_ERROR,
      keyPattern: { reference: 1 }
    })
    const create = vi
      .fn()
      .mockRejectedValueOnce(dupError)
      .mockResolvedValueOnce({})

    const result = await saveRegistration(makeRegistrations(create), validData)

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.reference).toMatch(/^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('rethrows non-duplicate errors from create', async () => {
    const networkError = new Error('connection reset')
    const create = vi.fn().mockRejectedValue(networkError)

    await expect(
      saveRegistration(makeRegistrations(create), validData)
    ).rejects.toThrow('connection reset')
  })

  test('rethrows a duplicate key error that has no keyPattern', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: MONGO_DUPLICATE_KEY_ERROR
    })
    const create = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeRegistrations(create), validData)
    ).rejects.toThrow('duplicate key')
    expect(create).toHaveBeenCalledTimes(1)
  })

  test('rethrows a duplicate history version instead of retrying', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: MONGO_DUPLICATE_KEY_ERROR,
      keyPattern: { reference: 1, version: 1 }
    })
    const create = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeRegistrations(create), validData)
    ).rejects.toThrow('duplicate key')
    expect(create).toHaveBeenCalledTimes(1)
  })

  test('rethrows duplicate key errors not on the reference field', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: MONGO_DUPLICATE_KEY_ERROR,
      keyPattern: { someOtherField: 1 }
    })
    const create = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeRegistrations(create), validData)
    ).rejects.toThrow('duplicate key')
  })

  test('throws after exhausting max retries on persistent reference collisions', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: MONGO_DUPLICATE_KEY_ERROR,
      keyPattern: { reference: 1 }
    })
    const create = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeRegistrations(create), validData)
    ).rejects.toThrow('Failed to generate a unique reference after 10 attempts')

    expect(create).toHaveBeenCalledTimes(10)
  })
})
