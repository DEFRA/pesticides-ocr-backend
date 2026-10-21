import {
  describe,
  test,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll
} from 'vitest'
import { MongoClient } from 'mongodb'

import { EMAIL_VERIFICATIONS_COLLECTION } from '#/common/constants/collections.js'
import { isEmailVerifiedForJourney } from '#/services/email-verification/registration-gate.js'
import {
  CONTACT_EMAIL,
  JOURNEY,
  seedVerification
} from '#/routes/registration/registration.fixtures.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

describe('#isEmailVerifiedForJourney', () => {
  let client
  let db

  beforeAll(async () => {
    client = await MongoClient.connect(process.env.MONGO_URI)
    db = client.db('registration-gate-test')
  })

  beforeEach(async () => {
    await db.collection(EMAIL_VERIFICATIONS_COLLECTION).deleteMany({})
  })

  afterAll(async () => {
    await client.close()
  })

  // The request endpoint stores the address trimmed and lower-cased, and the
  // gate normalises the submitted one the same way before comparing.
  test.each([
    ['the stored form', CONTACT_EMAIL],
    ['a different case', 'SPRAY@Everything.Biz'],
    ['surrounding whitespace', `  ${CONTACT_EMAIL}\t`]
  ])('matches a verified address given in %s', async (_label, email) => {
    await seedVerification(db)

    expect(
      await isEmailVerifiedForJourney(db, { journeyId: JOURNEY, email })
    ).toBe(true)
  })

  test('does not match another address', async () => {
    await seedVerification(db)

    expect(
      await isEmailVerifiedForJourney(db, {
        journeyId: JOURNEY,
        email: 'spray+other@everything.biz'
      })
    ).toBe(false)
  })
})
