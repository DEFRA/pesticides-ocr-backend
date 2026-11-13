import { MongoClient } from 'mongodb'

import { createRegistrationAccessRepository } from './registration-access.js'

describe('registration-access repository', () => {
  let client
  let db
  let repository

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('registration-access-test')
    repository = createRegistrationAccessRepository({ db })
  })

  beforeEach(async () => {
    await db.dropDatabase()
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  test('grant then isPermitted resolves true for that subject/reference pair', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001')
    ).resolves.toBe(true)
  })

  test('isPermitted resolves false when no grant exists', async () => {
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001')
    ).resolves.toBe(false)
  })

  test('isPermitted resolves false for a different subject with a grant on that reference', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await expect(
      repository.isPermitted('subj-2', 'OCR-AAA-001')
    ).resolves.toBe(false)
  })

  test('isPermitted resolves false for the same subject with a different reference', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await expect(
      repository.isPermitted('subj-1', 'OCR-BBB-002')
    ).resolves.toBe(false)
  })

  test('grant is idempotent: re-granting the same pair does not duplicate records', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    const grants = await repository.listForSubject('subj-1')
    expect(grants).toHaveLength(1)
  })

  test('re-granting renews grantedAt/expiresAt and clears a prior revocation', async () => {
    const firstGrant = new Date('2024-01-01T00:00:00Z')
    const firstExpiry = new Date('2024-01-01T00:30:00Z')
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-AAA-001',
      grantedAt: firstGrant,
      expiresAt: firstExpiry
    })
    await repository.revokeAllForReference('OCR-AAA-001')
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001')
    ).resolves.toBe(false)

    const secondGrant = new Date('2024-02-01T00:00:00Z')
    const secondExpiry = new Date('2024-02-01T00:30:00Z')
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-AAA-001',
      grantedAt: secondGrant,
      expiresAt: secondExpiry
    })

    const [grant] = await repository.listForSubject('subj-1')
    expect(grant.grantedAt).toEqual(secondGrant)
    expect(grant.expiresAt).toEqual(secondExpiry)
    expect(grant.revokedAt).toBeUndefined()
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001', {
        now: new Date('2024-02-01T00:15:00Z')
      })
    ).resolves.toBe(true)
  })

  test('isPermitted resolves false once the grant has expired', async () => {
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-AAA-001',
      grantedAt: new Date('2024-01-01T00:00:00Z'),
      expiresAt: new Date('2024-01-01T00:30:00Z')
    })

    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001', {
        now: new Date('2024-01-01T00:29:00Z')
      })
    ).resolves.toBe(true)
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001', {
        now: new Date('2024-01-01T00:30:01Z')
      })
    ).resolves.toBe(false)
  })

  test('isPermitted resolves true for a legacy grant with no expiresAt', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001')
    ).resolves.toBe(true)
  })

  test('revokeAllForReference revokes grants for every subject on that reference, leaving other references untouched', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    await repository.grant({ subject: 'subj-2', reference: 'OCR-AAA-001' })
    await repository.grant({ subject: 'subj-1', reference: 'OCR-BBB-002' })

    await repository.revokeAllForReference('OCR-AAA-001')

    await expect(
      repository.isPermitted('subj-1', 'OCR-AAA-001')
    ).resolves.toBe(false)
    await expect(
      repository.isPermitted('subj-2', 'OCR-AAA-001')
    ).resolves.toBe(false)
    await expect(
      repository.isPermitted('subj-1', 'OCR-BBB-002')
    ).resolves.toBe(true)
  })

  test('listForSubject returns all grants for a subject, newest first', async () => {
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-AAA-001',
      grantedAt: new Date('2024-01-01T00:00:00Z')
    })
    await repository.grant({
      subject: 'subj-1',
      reference: 'OCR-BBB-002',
      grantedAt: new Date('2024-02-01T00:00:00Z')
    })

    const grants = await repository.listForSubject('subj-1')
    expect(grants.map((g) => g.reference)).toEqual([
      'OCR-BBB-002',
      'OCR-AAA-001'
    ])
  })

  test('listForSubject returns an empty array for a subject with no grants', async () => {
    await expect(repository.listForSubject('subj-1')).resolves.toEqual([])
  })

  test('grant rejects an empty subject', async () => {
    await expect(
      repository.grant({ subject: '', reference: 'OCR-AAA-001' })
    ).rejects.toThrow(TypeError)
  })

  test('isPermitted rejects a non-string reference', async () => {
    await expect(repository.isPermitted('subj-1', 123)).rejects.toThrow()
  })

  test('documents returned by isPermitted/listForSubject never carry _id', async () => {
    await repository.grant({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    const [grant] = await repository.listForSubject('subj-1')
    expect(grant._id).toBeUndefined()
  })
})
