import { describe, test, expect, vi } from 'vitest'
import { saveRegistration, generateReference } from '#/services/registration.js'

function makeDb(insertOne) {
  return { collection: () => ({ insertOne }) }
}

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
    address: { line1: '1 Test St', town: 'Testville', postcode: 'TE1 1ST' },
    primaryContact: {
      name: 'Test User',
      telephone: '01234567890',
      email: 'test@test.com'
    },
    addressActivities: ['use'],
    quantity: { quantityType: 'area', quantity: '10' }
  }

  test('returns an PPP reference by default', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    const result = await saveRegistration(makeDb(insertOne), validData)

    expect(result.reference).toMatch(/^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('uses a custom prefix when provided', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    const result = await saveRegistration(makeDb(insertOne), validData, {
      prefix: 'SED'
    })

    expect(result.reference).toMatch(/^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('passes submittedAt timestamp to insertOne', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    await saveRegistration(makeDb(insertOne), validData)

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ submittedAt: expect.any(Date) })
    )
  })

  test('passes all provided data fields to insertOne', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    await saveRegistration(makeDb(insertOne), validData)

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: validData.businessName,
        businessActivities: validData.businessActivities
      })
    )
  })

  test('retries with a new reference on duplicate reference collision', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { reference: 1 }
    })
    const insertOne = vi
      .fn()
      .mockRejectedValueOnce(dupError)
      .mockResolvedValueOnce({ insertedId: 'abc' })

    const result = await saveRegistration(makeDb(insertOne), validData)

    expect(insertOne).toHaveBeenCalledTimes(2)
    expect(result.reference).toMatch(/^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('rethrows non-duplicate errors from insertOne', async () => {
    const networkError = new Error('connection reset')
    const insertOne = vi.fn().mockRejectedValue(networkError)

    await expect(
      saveRegistration(makeDb(insertOne), validData)
    ).rejects.toThrow('connection reset')
  })

  test('rethrows duplicate key errors not on the reference field', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { someOtherField: 1 }
    })
    const insertOne = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeDb(insertOne), validData)
    ).rejects.toThrow('duplicate key')
  })

  test('throws after exhausting max retries on persistent reference collisions', async () => {
    const dupError = Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { reference: 1 }
    })
    const insertOne = vi.fn().mockRejectedValue(dupError)

    await expect(
      saveRegistration(makeDb(insertOne), validData)
    ).rejects.toThrow('Failed to generate a unique reference after 10 attempts')

    expect(insertOne).toHaveBeenCalledTimes(10)
  })
})
