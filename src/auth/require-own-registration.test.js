import { MongoClient } from 'mongodb'

import { EXTERNAL_STRATEGY_NAME } from './strategy-name.js'
import {
  requireExternalUser,
  requireOwnRegistration
} from './require-own-registration.js'
import { createRegistrationAccessRepository } from '#/repositories/registration-access.js'

describe('requireExternalUser', () => {
  test('returns the external-bearer strategy + external_user scope', () => {
    expect(requireExternalUser()).toEqual({
      strategy: EXTERNAL_STRATEGY_NAME,
      scope: ['external_user']
    })
  })
})

describe('requireOwnRegistration', () => {
  let client
  let db
  let repository

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('require-own-registration-test')
    repository = createRegistrationAccessRepository({ db })
  })

  beforeEach(async () => {
    await db.dropDatabase()
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  function requestWith(credentials) {
    return { auth: { credentials }, db }
  }

  test('resolves when the token reference matches and a grant exists', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    await expect(
      requireOwnRegistration(request, 'OCR-AAA-001')
    ).resolves.toBeUndefined()
  })

  test('rejects with a generic 403 when the token reference does not match', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    await expect(
      requireOwnRegistration(request, 'OCR-BBB-002')
    ).rejects.toMatchObject({
      output: { statusCode: 403 }
    })
  })

  test('rejects with a generic 403 when the persisted grant is missing, even if the token claims it', async () => {
    // No grant() call — simulates a revoked/stale grant still named in an
    // unexpired token.
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    await expect(
      requireOwnRegistration(request, 'OCR-AAA-001')
    ).rejects.toMatchObject({
      output: { statusCode: 403 }
    })
  })

  test('rejects with a generic 403 when the grant has expired, even though the token has not', async () => {
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-AAA-001',
      grantedAt: new Date('2024-01-01T00:00:00Z'),
      expiresAt: new Date('2024-01-01T00:30:00Z')
    })
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    await expect(
      requireOwnRegistration(request, 'OCR-AAA-001')
    ).rejects.toMatchObject({
      output: { statusCode: 403 }
    })
  })

  test('rejects with a generic 403 when the grant has been revoked (e.g. contact-email change)', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await repository.revokeAllForReference('OCR-AAA-001')
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    await expect(
      requireOwnRegistration(request, 'OCR-AAA-001')
    ).rejects.toMatchObject({
      output: { statusCode: 403 }
    })
  })

  test('does not leak whether the other reference exists in the error message', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    const request = requestWith({
      subject: 'subj-1',
      registrationReference: 'OCR-AAA-001'
    })

    try {
      await requireOwnRegistration(request, 'OCR-BBB-002')
      throw new Error('expected requireOwnRegistration to reject')
    } catch (err) {
      expect(err.message).not.toContain('OCR-BBB-002')
    }
  })
})
