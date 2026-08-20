import { MongoClient } from 'mongodb'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { saveRegistration } from '#/services/registration.js'

describe('saveRegistration', () => {
  let client
  let db

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('test-registration')
    await db
      .collection('ocr-registration')
      .createIndex({ reference: 1 }, { unique: true })
  })

  afterAll(async () => {
    await db
      .collection('ocr-registration')
      .drop()
      .catch(() => {})
    await client.close()
  })

  const validData = {
    businessName: 'Test Co',
    businessActivities: ['manufacture'],
    address: {
      line1: '1 Test St',
      town: 'Testville',
      postcode: 'TE1 1ST'
    },
    primaryContact: {
      name: 'Test User',
      telephone: '01234567890',
      email: 'test@test.com'
    },
    addressActivities: ['use'],
    quantity: { quantityType: 'area', quantity: '10' }
  }

  test('inserts a document and returns a reference', async () => {
    const result = await saveRegistration(db, validData)

    expect(result.reference).toMatch(/^PP-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  })

  test('persists submittedAt timestamp', async () => {
    const result = await saveRegistration(db, validData)

    const doc = await db
      .collection('ocr-registration')
      .findOne({ reference: result.reference })

    expect(doc.submittedAt).toBeInstanceOf(Date)
  })

  test('persists all provided data fields', async () => {
    const result = await saveRegistration(db, validData)

    const doc = await db
      .collection('ocr-registration')
      .findOne({ reference: result.reference })

    expect(doc.businessName).toBe(validData.businessName)
    expect(doc.businessActivities).toEqual(validData.businessActivities)
  })

  test('generates a unique reference on duplicate collision', async () => {
    const results = await Promise.all([
      saveRegistration(db, validData),
      saveRegistration(db, validData)
    ])

    expect(results[0].reference).not.toBe(results[1].reference)
  })
})
