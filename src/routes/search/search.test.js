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

const abcRecords = Array.from({ length: 30 }, (_, index) => ({
  reference: `PPP-ABC-${String(index + 1).padStart(3, '0')}`,
  businessName: `Grower ${index + 1}`,
  submittedAt: new Date(Date.UTC(2026, 0, index + 1, 9, 30))
}))

const greenAcres = {
  reference: 'PPP-D4E-5F6',
  submittedAt: new Date('2026-05-02T10:00:00.000Z'),
  businessName: 'Green Acres Growers',
  businessActivities: ['manufacture'],
  mainCustomer: 'professional',
  address: {
    addressLine1: 'Highfield Farm',
    addressTown: 'Norwich',
    addressPostcode: 'NR1 1AA'
  },
  primaryContact: {
    contactName: 'Jane Doe',
    contactTelephone: '01234 567890',
    contactEmail: 'jane.doe@greenacres.example'
  },
  addressActivities: ['store'],
  quantity: { quantityType: 'amount', quantity: 500 },
  professionalSectors: ['agriculture-horticulture'],
  memberSchemes: ['BASIS'],
  additionalAddresses: []
}

const greenfield = {
  reference: 'PPP-D4E-5F7',
  submittedAt: greenAcres.submittedAt,
  businessName: 'Greenfield Farms',
  address: { addressTown: 'Ipswich', addressPostcode: 'IP1 2BB' },
  primaryContact: {
    contactName: 'Sam Doe',
    contactEmail: 'sam@greenfield.example'
  }
}

const references = (result) => result.data.map(({ reference }) => reference)

describe('#searchRoute', () => {
  let server
  let officerToken
  let viewerToken

  function get(url, token = officerToken) {
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
      .insertMany(
        [...abcRecords, greenAcres, greenfield].map((doc) => ({ ...doc }))
      )
  })

  afterAll(async () => {
    await server.stop()
  })

  describe('Authorisation', () => {
    test('401 and no registration data when no bearer token is presented', async () => {
      const { statusCode, result, headers } = await get('/search?q=ABC', null)

      expect(statusCode).toBe(401)
      expect(result).not.toHaveProperty('data')
      expect(headers['cache-control']).toBe('no-store')
    })

    test('403 and no registration data for a token without the case_officer role', async () => {
      const { statusCode, result, headers } = await get(
        '/search?q=ABC',
        viewerToken
      )

      expect(statusCode).toBe(403)
      expect(result).not.toHaveProperty('data')
      expect(headers['cache-control']).toBe('no-store')
    })

    test('200 for a case officer with valid criteria', async () => {
      const { statusCode, headers } = await get('/search?q=green')

      expect(statusCode).toBe(200)
      expect(headers['cache-control']).toBe('no-store')
    })
  })

  describe('Matching', () => {
    test('a partial reference returns every match, and only matches', async () => {
      const { result } = await get('/search?reference=ABC&pageSize=100')

      expect(result.pagination.totalRecords).toBe(30)
      expect(result.data).toHaveLength(30)
      expect(
        references(result).every((reference) => reference.includes('ABC'))
      ).toBe(true)
    })

    test('a full reference returns just that registration', async () => {
      const { result } = await get('/search?q=PPP-D4E-5F6')

      expect(references(result)).toEqual(['PPP-D4E-5F6'])
    })

    test('matches case-insensitively', async () => {
      const { result } = await get('/search?reference=abc')

      expect(result.pagination.totalRecords).toBe(30)
    })

    test.each([
      ['organisationName', 'acres'],
      ['applicantName', 'jane'],
      ['email', '@greenacres.'],
      ['town', 'norwich'],
      ['postcode', 'NR1']
    ])('matches a partial %s', async (criterion, term) => {
      const { result } = await get(`/search?${criterion}=${term}`)

      expect(references(result)).toEqual(['PPP-D4E-5F6'])
    })

    test.each([
      ['reference', 'D4E-5F6'],
      ['business name', 'acres'],
      ['contact name', 'jane'],
      ['email', '@greenacres.'],
      ['town', 'norwich'],
      ['postcode', 'NR1']
    ])('q matches on %s', async (_field, term) => {
      const { result } = await get(`/search?q=${term}`)

      expect(references(result)).toEqual(['PPP-D4E-5F6'])
    })

    test('requires every supplied criterion to match', async () => {
      const both = await get('/search?q=green&applicantName=sam')
      const neither = await get('/search?organisationName=acres&town=ipswich')

      expect(references(both.result)).toEqual(['PPP-D4E-5F7'])
      expect(neither.result.data).toEqual([])
    })

    test('treats * as a wildcard', async () => {
      const { result } = await get(
        `/search?reference=${encodeURIComponent('PPP-*-01*')}`
      )

      expect(references(result)).toEqual([
        'PPP-ABC-019',
        'PPP-ABC-018',
        'PPP-ABC-017',
        'PPP-ABC-016',
        'PPP-ABC-015',
        'PPP-ABC-014',
        'PPP-ABC-013',
        'PPP-ABC-012',
        'PPP-ABC-011',
        'PPP-ABC-010'
      ])
    })

    test('matches regex metacharacters literally', async () => {
      const { result } = await get(`/search?q=${encodeURIComponent('Gr.en')}`)

      expect(result.data).toEqual([])
    })

    test('returns an empty page when nothing matches', async () => {
      const { statusCode, result } = await get('/search?q=nothing-matches-this')

      expect(statusCode).toBe(200)
      expect(result).toEqual({
        data: [],
        pagination: { page: 1, pageSize: 10, totalRecords: 0, totalPages: 0 }
      })
    })
  })

  describe('Response shape and order', () => {
    test('returns the fields the register shows, as stored, and nothing else', async () => {
      const { result } = await get('/search?applicantName=jane')

      const {
        professionalSectors,
        memberSchemes,
        additionalAddresses,
        ...shown
      } = greenAcres
      expect(result.data).toEqual([shown])
    })

    test('does not expose the mongo _id', async () => {
      const { result } = await get('/search?q=green')

      expect(result.data[0]).not.toHaveProperty('_id')
    })

    test('orders newest first, breaking submittedAt ties by reference', async () => {
      const { result } = await get('/search?q=PPP')

      expect(references(result).slice(0, 4)).toEqual([
        'PPP-D4E-5F6',
        'PPP-D4E-5F7',
        'PPP-ABC-030',
        'PPP-ABC-029'
      ])
    })
  })

  describe('Pagination', () => {
    test('applies page 1 and the default page size when none are given', async () => {
      const { result } = await get('/search?reference=ABC')

      expect(result.data).toHaveLength(10)
      expect(result.data[0].reference).toBe('PPP-ABC-030')
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 10,
        totalRecords: 30,
        totalPages: 3
      })
    })

    test('returns only the requested page, with totals', async () => {
      const { result } = await get('/search?reference=ABC&page=2&pageSize=8')

      expect(references(result)).toEqual([
        'PPP-ABC-022',
        'PPP-ABC-021',
        'PPP-ABC-020',
        'PPP-ABC-019',
        'PPP-ABC-018',
        'PPP-ABC-017',
        'PPP-ABC-016',
        'PPP-ABC-015'
      ])
      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 8,
        totalRecords: 30,
        totalPages: 4
      })
    })

    test('returns the remainder on the last page', async () => {
      const { result } = await get('/search?reference=ABC&page=4&pageSize=8')

      expect(references(result)).toEqual([
        'PPP-ABC-006',
        'PPP-ABC-005',
        'PPP-ABC-004',
        'PPP-ABC-003',
        'PPP-ABC-002',
        'PPP-ABC-001'
      ])
    })

    test('returns an empty page, with totals, past the last page', async () => {
      const { statusCode, result } = await get('/search?reference=ABC&page=4')

      expect(statusCode).toBe(200)
      expect(result.data).toEqual([])
      expect(result.pagination.totalPages).toBe(3)
    })

    test('accepts the configured maximum page size', async () => {
      const { statusCode } = await get('/search?reference=ABC&pageSize=100')

      expect(statusCode).toBe(200)
    })
  })

  describe('Validation', () => {
    test.each([
      ['page 0', 'page=0', '"page" must be greater than or equal to 1'],
      ['a negative page', 'page=-1', '"page"'],
      ['a fractional page', 'page=1.5', '"page" must be an integer'],
      ['a non-numeric page', 'page=abc', '"page" must be a number'],
      ['a page beyond the cap', 'page=10001', '"page" must be less than'],
      ['pageSize 0', 'pageSize=0', '"pageSize" must be greater than'],
      [
        'pageSize over the configured maximum',
        'pageSize=101',
        '"pageSize" must be less than or equal to 100'
      ],
      ['a non-numeric pageSize', 'pageSize=ten', '"pageSize" must be a number'],
      ['a repeated page', 'page=1&page=2', '"page" must be a number']
    ])('400 for %s', async (_description, params, message) => {
      const { statusCode, result, headers } = await get(
        `/search?reference=ABC&${params}`
      )

      expect(statusCode).toBe(400)
      expect(result.message).toContain(message)
      expect(headers['cache-control']).toBe('no-store')
    })

    test('describes every invalid parameter, not just the first', async () => {
      const { result } = await get('/search?reference=ABC&page=0&pageSize=101')

      expect(result.message).toContain('"page"')
      expect(result.message).toContain('"pageSize"')
    })

    test('400 saying a criterion is required when none is given', async () => {
      const { statusCode, result } = await get('/search')

      expect(statusCode).toBe(400)
      expect(result.message).toBe(
        'At least one search criterion is required: q, reference, organisationName, applicantName, email, town, postcode'
      )
    })

    test('400 when only pagination parameters are given', async () => {
      const { statusCode, result } = await get('/search?page=1&pageSize=10')

      expect(statusCode).toBe(400)
      expect(result.message).toContain('At least one search criterion')
    })

    test.each([
      ['a blank q', 'q='],
      ['a whitespace q', 'q=%20%20'],
      ['an empty criterion', 'reference='],
      ['a wildcard-only term', 'q=**'],
      ['too many wildcards', 'organisationName=a*b*c*d*e*f*g'],
      ['an over-long term', `q=${'x'.repeat(101)}`],
      ['an unknown parameter', 'q=ABC&unexpected=value'],
      ['a repeated criterion', 'reference=ABC&reference=DEF']
    ])('400 for %s', async (_description, params) => {
      const { statusCode } = await get(`/search?${params}`)

      expect(statusCode).toBe(400)
    })

    test('does not query mongo for an invalid request', async () => {
      const collection = vi.spyOn(server.db, 'collection')

      await get('/search?q=')

      expect(collection).not.toHaveBeenCalled()

      await get('/search?q=green')

      expect(collection).toHaveBeenCalledWith('ocr-registration')

      collection.mockRestore()
    })
  })
})
