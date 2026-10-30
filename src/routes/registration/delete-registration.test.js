import { SignJWT } from 'jose'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import { VERSION_CONFLICT } from '#/common/constants/error-codes.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  MAX_REASON_LENGTH
} from '#/common/constants/history.js'
import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'

// The API runs in mock auth mode under test (ENVIRONMENT defaults to local), so
// tokens are decoded but not signature-verified.
const OFFICER_SUBJECT = 'officer-1'

function mockToken(roles, subject = OFFICER_SUBJECT) {
  const token = new SignJWT({ name: 'Test Officer', roles }).setProtectedHeader(
    {
      alg: 'HS256'
    }
  )
  if (subject) {
    token.setSubject(subject)
  }
  return token
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

const REASON = 'Duplicate registration'

describe('DELETE /registrations/{reference}', () => {
  let server
  let config
  let officerToken
  let viewerToken
  let registrations
  let history
  let nextReference = 0

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    const { createServer } = await import('#/server.js')
    ;({ config } = await import('#/config.js'))

    server = await createServer()
    await server.initialize()

    officerToken = await mockToken(['case_officer'])
    viewerToken = await mockToken(['viewer'])
    registrations = server.db.collection(OCR_REGISTRATION_COLLECTION)
    history = server.db.collection(OCR_REGISTRATION_HISTORY_COLLECTION)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop()
  })

  async function createRegistration() {
    nextReference += 1
    const reference = `PPP-DEL-${String(nextReference).padStart(3, '0')}`
    await server.registrations.create(
      { reference, businessName: 'Pesticides Ltd' },
      { by: { type: ACTOR_TYPE.APPLICANT } }
    )
    return reference
  }

  function del(reference, payload, { token = officerToken, headers } = {}) {
    return server.inject({
      method: 'DELETE',
      url: `/registrations/${reference}`,
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        ...headers
      },
      payload
    })
  }

  const stored = (reference) =>
    registrations.findOne({ reference }, { projection: { _id: 0 } })

  // The events the route logged with `tag` while `work` ran.
  async function logsTagged(tag, work) {
    const logged = []
    const listener = (_request, event, tags) => {
      if (tags[tag]) {
        logged.push(event)
      }
    }
    server.events.on({ name: 'request', channels: 'app' }, listener)
    try {
      await work()
    } finally {
      server.events.removeListener('request', listener)
    }
    return logged
  }

  const historyOf = (reference) =>
    history
      .find({ reference }, { projection: { _id: 0 } })
      .sort({ version: 1 })
      .toArray()

  describe('Authorisation', () => {
    test('401 before the request is validated, so it says nothing about the registration', async () => {
      const { statusCode } = await del(
        'not-a-reference',
        { x: 1 },
        {
          token: null
        }
      )

      expect(statusCode).toBe(401)
    })

    test('401 when no bearer token is presented', async () => {
      const reference = await createRegistration()

      const { statusCode, headers } = await del(
        reference,
        { version: FIRST_VERSION, reason: REASON },
        { token: null }
      )

      expect(statusCode).toBe(401)
      expect(headers['cache-control']).toBe('no-store')
      expect(await stored(reference)).toMatchObject({ isDeleted: false })
    })

    test('403 for a token without the case_officer role', async () => {
      const reference = await createRegistration()

      const { statusCode, headers } = await del(
        reference,
        { version: FIRST_VERSION, reason: REASON },
        { token: viewerToken }
      )

      expect(statusCode).toBe(403)
      expect(headers['cache-control']).toBe('no-store')
      expect(await stored(reference)).toMatchObject({ isDeleted: false })
    })

    test('403 for a token with no subject, as the history must say who deleted it', async () => {
      const reference = await createRegistration()

      const { statusCode } = await del(
        reference,
        { version: FIRST_VERSION, reason: REASON },
        { token: await mockToken(['case_officer'], null) }
      )

      expect(statusCode).toBe(403)
      expect(await stored(reference)).toMatchObject({ isDeleted: false })
    })
  })

  describe('Deleting', () => {
    test('200 marks the registration deleted without removing it', async () => {
      const reference = await createRegistration()

      const { statusCode, result, headers } = await del(reference, {
        version: FIRST_VERSION,
        reason: `  ${REASON}  `
      })

      expect(statusCode).toBe(200)
      expect(headers['cache-control']).toBe('no-store')
      expect(result).toEqual({
        reference,
        version: 2,
        deletedAt: expect.any(Date)
      })
      expect(await stored(reference)).toEqual({
        reference,
        businessName: 'Pesticides Ltd',
        isDeleted: true,
        version: 2,
        deletedAt: result.deletedAt,
        deletedBy: { type: ACTOR_TYPE.CASE_OFFICER, id: OFFICER_SUBJECT },
        deletionReason: REASON
      })
    })

    test('records one delete history entry at the new version, with the reason and request ID', async () => {
      const reference = await createRegistration()

      await del(
        reference,
        { version: FIRST_VERSION, reason: REASON },
        { headers: { [config.get('tracing.header')]: 'request-1' } }
      )

      const entries = await historyOf(reference)
      expect(entries.map(({ operation }) => operation)).toEqual([
        HISTORY_OPERATION.CREATE,
        HISTORY_OPERATION.DELETE
      ])
      expect(entries[1]).toMatchObject({
        version: 2,
        operation: HISTORY_OPERATION.DELETE,
        by: { type: ACTOR_TYPE.CASE_OFFICER, id: OFFICER_SUBJECT },
        reason: REASON,
        requestId: 'request-1',
        snapshot: { reference, isDeleted: true, version: 2 }
      })
    })

    test('passes the reference, version, reason, case officer and request ID to the repository', async () => {
      const reference = await createRegistration()
      const softDelete = vi.spyOn(server.registrations, 'softDelete')

      await del(
        reference,
        { version: FIRST_VERSION, reason: REASON },
        { headers: { [config.get('tracing.header')]: 'request-2' } }
      )

      expect(softDelete).toHaveBeenCalledExactlyOnceWith(reference, {
        by: { type: ACTOR_TYPE.CASE_OFFICER, id: OFFICER_SUBJECT },
        reason: REASON,
        requestId: 'request-2',
        expectedVersion: FIRST_VERSION
      })
    })

    test('logs the deletion for audit without the reason', async () => {
      const reference = await createRegistration()

      const logged = await logsTagged('audit', () =>
        del(reference, {
          version: FIRST_VERSION,
          reason: 'Duplicate of Jane Doe'
        })
      )

      expect(logged.map(({ data }) => data)).toEqual([
        `registration deleted: reference=${reference} version=2 subject=${OFFICER_SUBJECT} roles=case_officer`
      ])
    })

    test('a deleted registration no longer appears in search', async () => {
      const reference = await createRegistration()

      await del(reference, { version: FIRST_VERSION, reason: REASON })
      const { result } = await server.inject({
        method: 'GET',
        url: `/search?reference=${reference}`,
        headers: { authorization: `Bearer ${officerToken}` }
      })

      expect(result.data).toEqual([])
    })
  })

  describe('Refusals', () => {
    test('404 for an unknown reference', async () => {
      const { statusCode, result } = await del('PPP-ZZZ-999', {
        version: FIRST_VERSION,
        reason: REASON
      })

      expect(statusCode).toBe(404)
      expect(result.message).toBe('Registration not found')
    })

    test('404 for a registration that is already deleted, writing no more history', async () => {
      const reference = await createRegistration()
      await del(reference, { version: FIRST_VERSION, reason: REASON })

      const { statusCode } = await del(reference, {
        version: 2,
        reason: REASON
      })

      expect(statusCode).toBe(404)
      expect(await historyOf(reference)).toHaveLength(2)
    })

    test('409 for a stale version, changing nothing', async () => {
      const reference = await createRegistration()
      await server.registrations.update(
        reference,
        { businessName: 'Renamed Ltd' },
        {
          by: { type: ACTOR_TYPE.CASE_OFFICER, id: 'officer-2' },
          expectedVersion: FIRST_VERSION
        }
      )

      const { statusCode, result } = await del(reference, {
        version: FIRST_VERSION,
        reason: REASON
      })

      expect(statusCode).toBe(409)
      expect(result).toMatchObject({
        code: VERSION_CONFLICT,
        message:
          'The registration has changed since it was loaded. Reload it and try again.'
      })
      expect(await stored(reference)).toMatchObject({
        businessName: 'Renamed Ltd',
        isDeleted: false,
        version: 2
      })
      expect(await historyOf(reference)).toHaveLength(2)
    })

    test('500 when the delete fails, without saying why', async () => {
      const reference = await createRegistration()
      vi.spyOn(server.registrations, 'softDelete').mockRejectedValueOnce(
        new Error('db connection lost')
      )

      let response
      const logged = await logsTagged('error', async () => {
        response = await del(reference, {
          version: FIRST_VERSION,
          reason: REASON
        })
      })

      expect(response.statusCode).toBe(500)
      expect(response.result.message).toBe('An internal server error occurred')
      expect(logged.map(({ error }) => error?.message)).toEqual([
        'db connection lost'
      ])
      expect(await stored(reference)).toMatchObject({ isDeleted: false })
    })

    test.each([
      'PPP-ABC',
      'XYZ-ABC-123',
      'PPP-ABC-1234',
      'x'.repeat(MAX_REFERENCE_LENGTH + 1)
    ])('400 for an invalid reference: %s', async (reference) => {
      const { statusCode } = await del(reference, {
        version: FIRST_VERSION,
        reason: REASON
      })

      expect(statusCode).toBe(400)
    })

    test.each([
      ['no body', undefined],
      ['no version', { reason: REASON }],
      ['no reason', { version: FIRST_VERSION }],
      ['a blank reason', { version: FIRST_VERSION, reason: '   ' }],
      [
        'a reason that is too long',
        { version: FIRST_VERSION, reason: 'x'.repeat(MAX_REASON_LENGTH + 1) }
      ],
      ['a negative version', { version: -1, reason: REASON }],
      ['a decimal version', { version: 1.5, reason: REASON }],
      ['a version given as text', { version: '1', reason: REASON }],
      ['an unknown field', { version: FIRST_VERSION, reason: REASON, x: 1 }]
    ])('400 for %s, changing nothing', async (_label, payload) => {
      const reference = await createRegistration()

      const { statusCode } = await del(reference, payload)

      expect(statusCode).toBe(400)
      expect(await stored(reference)).toMatchObject({
        isDeleted: false,
        version: FIRST_VERSION
      })
    })
  })
})
