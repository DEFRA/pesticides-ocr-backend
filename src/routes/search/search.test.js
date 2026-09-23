import { SignJWT } from 'jose'

// The API runs in mock auth mode under test (ENVIRONMENT defaults to local), so
// tokens are decoded but not signature-verified. These helpers mint tokens that
// carry (or omit) the case-officer role to exercise the RBAC on the route.
function mockToken(roles) {
  return new SignJWT({ name: 'Test Officer', roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('officer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

describe('#searchRoute', () => {
  let server
  let officerToken
  let viewerToken

  const record = {
    reference: 'PPP-A1B-2C3',
    businessName: 'Pesticides Ltd',
    submittedAt: new Date('2026-03-11T09:30:00.000Z')
  }

  const otherRecord = {
    reference: 'PPP-D4E-5F6',
    businessName: 'Green Acres Growers',
    submittedAt: new Date('2026-05-02T10:00:00.000Z')
  }

  function get(url, token) {
    return server.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
  }

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()

    officerToken = await mockToken(['case_officer'])
    viewerToken = await mockToken(['viewer'])

    await server.db
      .collection('ocr-registration')
      .insertMany([{ ...record }, { ...otherRecord }])
  })

  afterAll(async () => {
    await server.stop()
  })

  describe('Authorisation', () => {
    test('401 when no bearer token is presented', async () => {
      const { statusCode } = await get('/search?reference=PPP-A1B-2C3')

      expect(statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      const { statusCode } = await get(
        '/search?reference=PPP-A1B-2C3',
        viewerToken
      )

      expect(statusCode).toBe(403)
    })
  })

  describe('Basic search by reference', () => {
    test('Should return the record for a known reference number', async () => {
      const { statusCode, result } = await get(
        '/search?reference=PPP-A1B-2C3',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(result.reference).toBe('PPP-A1B-2C3')
    })

    test('Should keep the record out of shared caches', async () => {
      const { headers } = await get(
        '/search?reference=PPP-A1B-2C3',
        officerToken
      )

      expect(headers['cache-control']).toBe('no-store')
    })

    test('Should not expose the mongo _id', async () => {
      const { result } = await get(
        '/search?reference=PPP-A1B-2C3',
        officerToken
      )

      expect(result).not.toHaveProperty('_id')
    })

    test('Should return 404 for a well formed reference that does not exist', async () => {
      const { statusCode, result } = await get(
        '/search?reference=PPP-ZZZ-999',
        officerToken
      )

      expect(statusCode).toBe(404)
      expect(result.message).toBe(
        'No records found for the reference number provided'
      )
    })

    test('Should return 400 for a malformed reference number', async () => {
      const { statusCode, result } = await get(
        '/search?reference=not-a-reference',
        officerToken
      )

      expect(statusCode).toBe(400)
      expect(result.message).toBe('Invalid reference number')
    })

    test('Should return 400 for a lower case reference number', async () => {
      const { statusCode } = await get(
        '/search?reference=ppp-a1b-2c3',
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    test('Should return 400 when the reference query parameter is empty', async () => {
      const { statusCode } = await get('/search?reference=', officerToken)

      expect(statusCode).toBe(400)
    })

    test('Should return 400 when the reference query parameter is repeated', async () => {
      const { statusCode } = await get(
        '/search?reference=PPP-A1B-2C3&reference=PPP-ZZZ-999',
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    test('Should not query mongo for a malformed reference number', async () => {
      const collection = vi.spyOn(server.db, 'collection')

      await get('/search?reference=not-a-reference', officerToken)

      expect(collection).not.toHaveBeenCalled()

      // Prove the spy would have caught a query had one been made
      await get('/search?reference=PPP-A1B-2C3', officerToken)

      expect(collection).toHaveBeenCalledWith('ocr-registration')

      collection.mockRestore()
    })
  })

  describe('Advanced search by free-text term', () => {
    test('Should match on a business name, newest first', async () => {
      const { statusCode, result } = await get('/search?q=Green', officerToken)

      expect(statusCode).toBe(200)
      expect(result).toHaveLength(1)
      expect(result[0].reference).toBe('PPP-D4E-5F6')
    })

    test('Should return every registration for a blank term', async () => {
      const { statusCode, result } = await get('/search?q=', officerToken)

      expect(statusCode).toBe(200)
      expect(result).toHaveLength(2)
    })

    test('Should keep the results out of shared caches', async () => {
      const { headers } = await get('/search?q=', officerToken)

      expect(headers['cache-control']).toBe('no-store')
    })

    test('Should order results newest first', async () => {
      const { result } = await get('/search?q=', officerToken)

      expect(result.map((r) => r.reference)).toEqual([
        'PPP-D4E-5F6',
        'PPP-A1B-2C3'
      ])
    })

    test('Should return an empty list when nothing matches', async () => {
      const { statusCode, result } = await get(
        '/search?q=nothing-matches-this',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(result).toEqual([])
    })

    test('Should not expose the mongo _id on advanced results', async () => {
      const { result } = await get('/search?q=', officerToken)

      expect(result[0]).not.toHaveProperty('_id')
    })
  })

  describe('Query contract', () => {
    test('Should return 400 when both reference and q are given', async () => {
      const { statusCode } = await get(
        '/search?reference=PPP-A1B-2C3&q=Green',
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    // "Everything" is asked for explicitly with a blank ?q=, never implied.
    test('Should return 400 when neither reference nor q is given', async () => {
      const { statusCode } = await get('/search', officerToken)

      expect(statusCode).toBe(400)
    })

    test('Should return 400 for an over-long search term', async () => {
      const { statusCode } = await get(
        `/search?q=${'x'.repeat(101)}`,
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    test('Should return 400 for an unknown query parameter', async () => {
      const { statusCode } = await get(
        '/search?reference=PPP-A1B-2C3&unexpected=value',
        officerToken
      )

      expect(statusCode).toBe(400)
    })
  })
})
