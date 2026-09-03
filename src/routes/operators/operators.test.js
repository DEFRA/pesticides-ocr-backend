import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { SignJWT } from 'jose'

// The API runs in mock auth mode under test (ENVIRONMENT defaults to local), so
// tokens are decoded but not signature-verified. These helpers mint tokens that
// carry (or omit) the case-officer role to exercise the RBAC on the routes.
function mockToken(roles) {
  return new SignJWT({ name: 'Test Officer', roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('officer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

// Two stored registrations that differ across the searchable fields, so a search
// term can be shown to filter.
const docs = [
  {
    reference: 'PPP-A1B-2C3',
    submittedAt: new Date('2026-03-11T09:30:00.000Z'),
    businessName: 'Pesticides Ltd',
    businessActivities: ['manufacture'],
    address: { line1: 'Highfield Farm', town: 'Farmtown', postcode: 'PH1 1FT' },
    primaryContact: {
      name: 'John Smith',
      telephone: '01234 567890',
      email: 'john@pesticides.example'
    },
    addressActivities: ['use'],
    quantity: { quantityType: 'amount', quantity: 80000 }
  },
  {
    reference: 'PPP-D4E-5F6',
    submittedAt: new Date('2026-05-02T10:00:00.000Z'),
    businessName: 'Green Acres Growers',
    businessActivities: ['use-professional'],
    address: { line1: '2 Meadow Lane', town: 'Cropwell', postcode: 'NG12 3AB' },
    primaryContact: {
      name: 'Priya Patel',
      telephone: '0115 900 1234',
      email: 'priya@greenacres.example'
    },
    addressActivities: ['use', 'store'],
    quantity: { quantityType: 'area', quantity: 1500 }
  }
]

describe('#operatorsRoutes', () => {
  let server
  let officerToken
  let viewerToken

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb.
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()

    await server.db
      .collection('ocr-registration')
      .insertMany(docs.map((doc) => ({ ...doc })))

    officerToken = await mockToken(['case_officer'])
    viewerToken = await mockToken(['viewer'])
  })

  afterAll(async () => {
    await server.stop()
  })

  function getOperators(url, token) {
    return server.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
  }

  describe('GET /operators', () => {
    test('401 when no bearer token is presented', async () => {
      const { statusCode } = await getOperators('/operators')
      expect(statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      const { statusCode } = await getOperators('/operators', viewerToken)
      expect(statusCode).toBe(403)
    })

    test('200 returns all operators in the Operator contract shape', async () => {
      const { statusCode, result } = await getOperators(
        '/operators',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(result).toHaveLength(2)

      const ltd = result.find((op) => op.reference === 'PPP-A1B-2C3')
      expect(ltd).toMatchObject({
        businessName: 'Pesticides Ltd',
        activities: ['Manufacture, process or import'],
        mainCustomer: 'N/A',
        address: {
          line1: 'Highfield Farm',
          town: 'Farmtown',
          postcode: 'PH1 1FT',
          country: ''
        },
        contact: {
          name: 'John Smith',
          email: 'john@pesticides.example',
          telephone: '01234 567890'
        },
        quantity: '80,000 litres or kilograms',
        registeredDate: '2026-03-11',
        status: 'Registered'
      })
    })

    test('does not expose the mongo _id', async () => {
      const { result } = await getOperators('/operators', officerToken)
      expect(result.every((op) => !('_id' in op))).toBe(true)
    })

    test('filters by a search term (business name, case-insensitive)', async () => {
      const { result } = await getOperators(
        '/operators?search=green',
        officerToken
      )
      expect(result).toHaveLength(1)
      expect(result[0].businessName).toBe('Green Acres Growers')
    })

    test('filters by postcode', async () => {
      const { result } = await getOperators(
        '/operators?search=NG12',
        officerToken
      )
      expect(result).toHaveLength(1)
      expect(result[0].reference).toBe('PPP-D4E-5F6')
    })

    test('filters by reference', async () => {
      const { result } = await getOperators(
        '/operators?search=A1B',
        officerToken
      )
      expect(result).toHaveLength(1)
      expect(result[0].reference).toBe('PPP-A1B-2C3')
    })

    test('filters by contact name', async () => {
      const { result } = await getOperators(
        '/operators?search=priya',
        officerToken
      )
      expect(result).toHaveLength(1)
      expect(result[0].reference).toBe('PPP-D4E-5F6')
    })

    test('filters by town', async () => {
      const { result } = await getOperators(
        '/operators?search=farmtown',
        officerToken
      )
      expect(result).toHaveLength(1)
      expect(result[0].reference).toBe('PPP-A1B-2C3')
    })

    test('a blank/whitespace term returns all', async () => {
      const { result } = await getOperators(
        '/operators?search=%20',
        officerToken
      )
      expect(result).toHaveLength(2)
    })

    test('400 for an over-length search term', async () => {
      const { statusCode } = await getOperators(
        `/operators?search=${'x'.repeat(101)}`,
        officerToken
      )
      expect(statusCode).toBe(400)
    })
  })

  describe('GET /operators/{reference}', () => {
    test('401 when no bearer token is presented', async () => {
      const { statusCode } = await getOperators('/operators/PPP-A1B-2C3')
      expect(statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      const { statusCode } = await getOperators(
        '/operators/PPP-A1B-2C3',
        viewerToken
      )
      expect(statusCode).toBe(403)
    })

    test('200 returns the operator when the reference exists', async () => {
      const { statusCode, result } = await getOperators(
        '/operators/PPP-A1B-2C3',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(result.businessName).toBe('Pesticides Ltd')
    })

    test('404 when the reference does not exist', async () => {
      const { statusCode } = await getOperators(
        '/operators/PPP-ZZZ-999',
        officerToken
      )
      expect(statusCode).toBe(404)
    })
  })

  describe('GET /operators/export', () => {
    test('401 when no bearer token is presented', async () => {
      const { statusCode } = await getOperators('/operators/export')
      expect(statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      const { statusCode } = await getOperators(
        '/operators/export',
        viewerToken
      )
      expect(statusCode).toBe(403)
    })

    test('200 returns CSV with download headers and a header + data rows', async () => {
      const { statusCode, headers, payload } = await getOperators(
        '/operators/export',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(headers['content-type']).toContain('text/csv')
      expect(headers['content-disposition']).toBe(
        'attachment; filename="ocr-registrations.csv"'
      )
      const lines = payload.split('\r\n')
      expect(lines[0]).toContain('"Reference"')
      expect(lines).toHaveLength(3) // header + 2 seeded operators
      expect(payload).toContain('"Pesticides Ltd"')
      expect(payload).toContain('"Green Acres Growers"')
    })

    test('applies the search filter to the export', async () => {
      const { payload } = await getOperators(
        '/operators/export?search=green',
        officerToken
      )
      const lines = payload.split('\r\n')
      expect(lines).toHaveLength(2) // header + 1 match
      expect(payload).toContain('"Green Acres Growers"')
      expect(payload).not.toContain('"Pesticides Ltd"')
    })

    test('returns the header row only when nothing matches', async () => {
      const { statusCode, payload } = await getOperators(
        '/operators/export?search=no-such-operator',
        officerToken
      )
      expect(statusCode).toBe(200)
      expect(payload.split('\r\n')).toHaveLength(1)
      expect(payload).toContain('"Reference"')
    })

    test('400 for an over-length search term', async () => {
      const { statusCode } = await getOperators(
        `/operators/export?search=${'x'.repeat(101)}`,
        officerToken
      )
      expect(statusCode).toBe(400)
    })
  })
})
