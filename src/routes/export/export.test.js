import { SignJWT } from 'jose'

// The API runs in mock auth mode under test (ENVIRONMENT defaults to local), so
// tokens are decoded but not signature-verified.
function mockToken(roles) {
  return new SignJWT({ name: 'Test Officer', roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('officer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

const MAX_SEARCH_LENGTH = 100

describe('#exportRoute', () => {
  let server
  let config
  let officerToken
  let viewerToken

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
    ;({ config } = await import('#/config.js'))

    server = await createServer()
    await server.initialize()

    officerToken = await mockToken(['case_officer'])
    viewerToken = await mockToken(['viewer'])

    await server.db.collection('ocr-registration').insertMany([
      {
        reference: 'PPP-A1B-2C3',
        businessName: 'Pesticides Ltd',
        submittedAt: new Date('2026-03-11T09:30:00.000Z')
      },
      {
        reference: 'PPP-D4E-5F6',
        businessName: 'Green Acres Growers',
        submittedAt: new Date('2026-05-02T10:00:00.000Z')
      }
    ])
  })

  afterAll(async () => {
    await server.stop()
  })

  describe('Authorisation', () => {
    test('401 when no bearer token is presented', async () => {
      const { statusCode } = await get('/export')

      expect(statusCode).toBe(401)
    })

    test('403 for a token without the case_officer role', async () => {
      const { statusCode } = await get('/export', viewerToken)

      expect(statusCode).toBe(403)
    })
  })

  describe('Exporting the matching set', () => {
    test('200 returns CSV with download headers and a header + data rows', async () => {
      const { statusCode, headers, payload } = await get(
        '/export?q=',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(headers['content-type']).toContain('text/csv')
      expect(headers['content-disposition']).toBe(
        'attachment; filename="ocr-registrations.csv"'
      )
      expect(headers['cache-control']).toBe('no-store')

      const lines = payload.split('\r\n')
      expect(lines[0]).toContain('"Reference"')
      expect(lines).toHaveLength(3) // header + 2 seeded registrations
      expect(payload).toContain('"Pesticides Ltd"')
      expect(payload).toContain('"Green Acres Growers"')
    })

    test('applies a free-text term to the export', async () => {
      const { payload } = await get('/export?q=green', officerToken)

      expect(payload.split('\r\n')).toHaveLength(2) // header + 1 match
      expect(payload).toContain('"Green Acres Growers"')
      expect(payload).not.toContain('"Pesticides Ltd"')
    })

    test('exports a single record when given a reference', async () => {
      const { statusCode, payload } = await get(
        '/export?reference=PPP-A1B-2C3',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(payload.split('\r\n')).toHaveLength(2) // header + 1 record
      expect(payload).toContain('"Pesticides Ltd"')
    })

    test('returns the header row only when nothing matches', async () => {
      const { statusCode, payload } = await get(
        '/export?q=no-such-registration',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(payload.split('\r\n')).toHaveLength(1)
      expect(payload).toContain('"Reference"')
    })

    test('returns the header row only for a reference that does not exist', async () => {
      const { statusCode, payload } = await get(
        '/export?reference=PPP-ZZZ-999',
        officerToken
      )

      expect(statusCode).toBe(200)
      expect(payload.split('\r\n')).toHaveLength(1)
    })
  })

  // Two registrations are seeded, so a limit of 1 is exceeded and 2 is not.
  describe('Row limit', () => {
    let originalMaxRows

    beforeEach(() => {
      originalMaxRows = config.get('export.maxRows')
    })

    afterEach(() => {
      config.set('export.maxRows', originalMaxRows)
    })

    test('400 rather than a truncated file when the match exceeds the limit', async () => {
      config.set('export.maxRows', 1)

      const { statusCode, result } = await get('/export?q=', officerToken)

      expect(statusCode).toBe(400)
      expect(result.message).toBe(
        'The export is limited to 1 registrations. Narrow the search and try again.'
      )
    })

    test('audit-logs a refusal without the search term', async () => {
      config.set('export.maxRows', 1)
      const audits = []
      const onRequest = (_request, event) => {
        if (event.tags?.includes('audit')) {
          audits.push(event.data)
        }
      }
      server.events.on('request', onRequest)
      try {
        // Both seeded names contain 'e', so this term matches two rows and is
        // refused at a limit of 1.
        await get('/export?q=e', officerToken)
      } finally {
        server.events.removeListener('request', onRequest)
      }

      // Exact match: the refusal records who and the limit, and nothing from
      // the query.
      expect(audits).toEqual([
        'registrations export refused: subject=officer-1 roles=case_officer over maxRows=1'
      ])
    })

    test('exports every row when the match is exactly the limit', async () => {
      config.set('export.maxRows', 2)

      const { statusCode, payload } = await get('/export?q=', officerToken)

      expect(statusCode).toBe(200)
      expect(payload.split('\r\n')).toHaveLength(3) // header + 2 registrations
    })
  })

  describe('Query contract', () => {
    test('400 for a malformed reference', async () => {
      const { statusCode, result } = await get(
        '/export?reference=not-a-reference',
        officerToken
      )

      expect(statusCode).toBe(400)
      expect(result.message).toBe('Invalid reference number')
    })

    test('does not query mongo for a malformed reference', async () => {
      const collection = vi.spyOn(server.db, 'collection')

      await get('/export?reference=not-a-reference', officerToken)

      expect(collection).not.toHaveBeenCalled()

      // Prove the spy would have caught a query had one been made
      await get('/export?reference=PPP-A1B-2C3', officerToken)

      expect(collection).toHaveBeenCalledWith('ocr-registration')

      collection.mockRestore()
    })

    test('400 for an over-length search term', async () => {
      const { statusCode } = await get(
        `/export?q=${'x'.repeat(MAX_SEARCH_LENGTH + 1)}`,
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    test('400 when both reference and q are given', async () => {
      const { statusCode } = await get(
        '/export?reference=PPP-A1B-2C3&q=green',
        officerToken
      )

      expect(statusCode).toBe(400)
    })

    // Exporting the whole register must be an explicit ask (?q=), never the
    // result of a bare request.
    test('400 when neither reference nor q is given', async () => {
      const { statusCode } = await get('/export', officerToken)

      expect(statusCode).toBe(400)
    })
  })

  test('audit-logs who/how-many/filtered, never the raw search term', async () => {
    const audits = []
    const onRequest = (_request, event) => {
      if (event.tags?.includes('audit')) {
        audits.push(event.data)
      }
    }
    server.events.on('request', onRequest)
    try {
      await get('/export?q=green', officerToken)
    } finally {
      server.events.removeListener('request', onRequest)
    }

    expect(audits).toHaveLength(1)
    const message = audits[0]
    expect(message).toContain('roles=case_officer')
    expect(message).toContain('rows=1')
    expect(message).toContain('filtered=true')
    // The search term may be a person's name (PII) — it must never be logged.
    expect(message).not.toContain('green')
  })
})
