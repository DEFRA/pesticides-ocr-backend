import { SignJWT } from 'jose'

import { ACTOR_TYPE } from '#/common/constants/actors.js'
import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import { HISTORY_OPERATION } from '#/common/constants/history.js'
import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'

const applicant = { type: ACTOR_TYPE.APPLICANT }
const officer = { type: ACTOR_TYPE.CASE_OFFICER, id: 'history-officer' }

function mockToken(roles) {
  return new SignJWT({ roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(officer.id)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

describe('GET /registrations/{reference}/history', () => {
  let server
  let officerToken
  let viewerToken
  let registrations
  let history
  let nextReference = 0

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
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
    const reference = `PPP-HIS-${String(++nextReference).padStart(3, '0')}`
    await server.registrations.create(
      { reference, businessName: 'Original organisation' },
      { by: applicant, requestId: 'creation-request' }
    )
    return reference
  }

  async function createVersions() {
    const reference = await createRegistration()
    for (let version = 1; version < 4; version++) {
      await server.registrations.update(
        reference,
        { businessName: `Organisation version ${version + 1}` },
        {
          expectedVersion: version,
          by: officer,
          reason: 'Corrected business name',
          requestId: `update-${version}`
        }
      )
    }
    return reference
  }

  function get(reference, query = '', token = officerToken) {
    return server.inject({
      method: 'GET',
      url: `/registrations/${reference}/history${query}`,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
  }

  test('returns complete metadata and snapshots for only the requested registration, newest first', async () => {
    const reference = await createVersions()
    await createRegistration()
    const expected = await history
      .find({ reference }, { projection: { _id: 0 } })
      .sort({ version: -1 })
      .toArray()

    const response = await get(reference)

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body).toEqual({
      data: JSON.parse(JSON.stringify(expected)),
      pagination: { pageSize: 50, nextBeforeVersion: null }
    })
    expect(body.data.map(({ version }) => version)).toEqual([4, 3, 2, 1])
    expect(body.data[0]).toMatchObject({
      reference,
      version: 4,
      operation: HISTORY_OPERATION.UPDATE,
      at: expect.any(String),
      by: officer,
      reason: 'Corrected business name',
      requestId: 'update-3',
      snapshot: {
        reference,
        version: 4,
        businessName: 'Organisation version 4'
      }
    })
    expect(body.data[3].by).toEqual(applicant)
    expect(body.data[3]).not.toHaveProperty('reason')
    expect(body.data[0]).not.toHaveProperty('_id')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  test('walks pages without duplicates or omissions when a newer version is added', async () => {
    const reference = await createVersions()
    const first = await get(reference, '?pageSize=2')
    expect(first.result.data.map(({ version }) => version)).toEqual([4, 3])
    expect(first.result.pagination).toEqual({
      pageSize: 2,
      nextBeforeVersion: 3
    })

    await server.registrations.update(
      reference,
      { businessName: 'New version' },
      {
        by: officer,
        expectedVersion: 4
      }
    )
    const second = await get(
      reference,
      `?pageSize=2&beforeVersion=${first.result.pagination.nextBeforeVersion}`
    )
    expect(second.result.data.map(({ version }) => version)).toEqual([2, 1])
    expect(second.result.pagination.nextBeforeVersion).toBeNull()
  })

  test('bounds a page in the repository instead of loading the complete history', async () => {
    const reference = await createRegistration()
    const base = await history.findOne(
      { reference },
      { projection: { _id: 0 } }
    )
    await history.insertMany(
      Array.from({ length: 104 }, (_, index) => ({
        ...base,
        version: index + 2,
        snapshot: { ...base.snapshot, version: index + 2 }
      }))
    )
    const list = vi.spyOn(server.registrations, 'listHistory')
    const find = vi.spyOn(server.registrations, 'findByReference')

    const first = await get(reference)
    expect(first.result.data).toHaveLength(50)
    expect(first.result.data[0].version).toBe(105)
    expect(first.result.pagination.nextBeforeVersion).toBe(56)
    expect(list).toHaveBeenCalledExactlyOnceWith(reference, {
      pageSize: 50,
      beforeVersion: undefined
    })
    expect(await list.mock.results[0].value).toHaveLength(51)
    expect(find).not.toHaveBeenCalled()

    const maximum = await get(reference, '?pageSize=100')
    expect(maximum.result.data).toHaveLength(100)
    expect(maximum.result.pagination.nextBeforeVersion).toBe(6)
    expect(list).toHaveBeenLastCalledWith(reference, {
      pageSize: 100,
      beforeVersion: undefined
    })
  })

  test('allows case officers to read soft-deleted registration history', async () => {
    const reference = await createRegistration()
    await server.registrations.softDelete(reference, {
      expectedVersion: 1,
      by: officer,
      reason: 'Duplicate'
    })
    expect(await server.registrations.findByReference(reference)).toBeNull()

    const response = await get(reference)
    expect(response.statusCode).toBe(200)
    expect(response.result.data.map(({ operation }) => operation)).toEqual([
      HISTORY_OPERATION.DELETE,
      HISTORY_OPERATION.CREATE
    ])
    expect(response.result.data[0].snapshot.isDeleted).toBe(true)
  })

  test.each([false, true])(
    'returns 404 for a legacy registration without history (isDeleted=%s)',
    async (isDeleted) => {
      const reference = `PPP-LEG-${String(++nextReference).padStart(3, '0')}`
      await registrations.insertOne({
        reference,
        businessName: 'Legacy',
        isDeleted
      })

      const response = await get(reference)
      expect(response.statusCode).toBe(404)
      expect(response.result.message).toBe('Registration history not found')
      expect(response.headers['cache-control']).toBe('no-store')
    }
  )

  test('returns 404 for an exhausted cursor even when newer history exists', async () => {
    const reference = await createRegistration()
    const response = await get(reference, '?beforeVersion=1')

    expect(response.statusCode).toBe(404)
    expect(response.result.message).toBe('Registration history not found')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  test('retains access to history if its current registration no longer exists', async () => {
    const reference = await createRegistration()
    await registrations.deleteOne({ reference })

    expect((await get(reference)).result.data).toHaveLength(1)
    const exhausted = await get(reference, '?beforeVersion=1')
    expect(exhausted.statusCode).toBe(404)
  })

  test('404 when neither registration nor history exists, including with a cursor', async () => {
    for (const query of ['', '?beforeVersion=2']) {
      const response = await get('PPP-NON-001', query)
      expect(response.statusCode).toBe(404)
      expect(response.headers['cache-control']).toBe('no-store')
    }
  })

  test('retrieval does not modify the registration or any history entries', async () => {
    const reference = await createVersions()
    const before = {
      registration: await registrations.findOne({ reference }),
      history: await history.find({ reference }).sort({ version: 1 }).toArray()
    }
    await get(reference, '?pageSize=2')
    await get(reference, '?pageSize=2&beforeVersion=3')
    expect(await registrations.findOne({ reference })).toEqual(
      before.registration
    )
    expect(
      await history.find({ reference }).sort({ version: 1 }).toArray()
    ).toEqual(before.history)
  })

  test.each([
    ['missing token', null, 401],
    ['invalid token', 'not-a-token', 401],
    ['wrong role', () => viewerToken, 403]
  ])('rejects %s before any repository read', async (_label, token, status) => {
    const list = vi.spyOn(server.registrations, 'listHistory')
    const find = vi.spyOn(server.registrations, 'findByReference')
    const response = await get(
      'not-a-reference',
      '?pageSize=invalid',
      typeof token === 'function' ? token() : token
    )
    expect(response.statusCode).toBe(status)
    expect(list).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    expect(response.headers['cache-control']).toBe('no-store')
  })

  test.each([
    'PPP-ABC',
    'XYZ-ABC-123',
    'PPP-ABC-1234',
    'x'.repeat(MAX_REFERENCE_LENGTH + 1)
  ])('rejects invalid reference %s', async (reference) => {
    const list = vi.spyOn(server.registrations, 'listHistory')
    expect((await get(reference)).statusCode).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  test.each([
    'pageSize=0',
    'pageSize=-1',
    'pageSize=1.5',
    'pageSize=101',
    'pageSize=abc',
    'pageSize=',
    'pageSize=2&pageSize=3',
    'beforeVersion=0',
    'beforeVersion=-1',
    'beforeVersion=1.5',
    'beforeVersion=abc',
    'beforeVersion=9007199254740992',
    'beforeVersion=',
    'beforeVersion=1&beforeVersion=2',
    'unknown=1',
    'page=1'
  ])('rejects invalid query %s before reading history', async (query) => {
    const list = vi.spyOn(server.registrations, 'listHistory')
    expect((await get('PPP-HIS-001', `?${query}`)).statusCode).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  test.each([
    ['pageSize=abc', 'pageSize must be an integer'],
    ['pageSize=1.5', 'pageSize must be an integer'],
    ['pageSize=0', 'pageSize must be at least 1'],
    ['pageSize=101', 'pageSize must be at most 100'],
    ['beforeVersion=abc', 'beforeVersion must be an integer'],
    ['beforeVersion=1.5', 'beforeVersion must be an integer'],
    ['beforeVersion=0', 'beforeVersion must be a positive integer'],
    ['beforeVersion=9007199254740992', 'beforeVersion must be a safe integer']
  ])('returns a clear validation message for %s', async (query, message) => {
    const response = await get('PPP-HIS-001', `?${query}`)
    expect(response.statusCode).toBe(400)
    expect(response.result.message).toContain(message)
  })

  test('logs repository errors and returns a sanitised 500, not an empty page', async () => {
    const failure = new Error('database connection unavailable')
    vi.spyOn(server.registrations, 'listHistory').mockRejectedValueOnce(failure)
    const logged = []
    const listener = (_request, event, tags) => {
      if (tags.error) logged.push(event)
    }
    server.events.on({ name: 'request', channels: 'app' }, listener)
    try {
      const response = await get('PPP-HIS-001')
      expect(response.statusCode).toBe(500)
      expect(response.result.message).toBe('An internal server error occurred')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(logged.map(({ error }) => error?.message)).toContain(
        failure.message
      )
    } finally {
      server.events.removeListener('request', listener)
    }
  })
})
