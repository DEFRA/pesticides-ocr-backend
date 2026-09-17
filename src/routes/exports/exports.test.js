import { describe, test, expect, beforeAll, afterAll } from 'vitest'

// A stored registration to export. Kept flat: the serialiser has no nested-field
// mapping (see services/export/export.test.js).
const record = {
  reference: 'PPP-A1B-2C3',
  businessName: 'Pesticides Ltd',
  mainCustomer: 'Farmers'
}

describe('#exportsRoutes', () => {
  let server

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb.
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()

    await server.db.collection('ocr-registration').insertOne({ ...record })
  })

  afterAll(async () => {
    await server.stop()
  })

  const getExport = (url) => server.inject({ method: 'GET', url })

  describe('GET /export', () => {
    test('200 returns the record as a CSV header row plus one value row', async () => {
      const { statusCode, payload } = await getExport(
        '/export?reference=PPP-A1B-2C3'
      )

      expect(statusCode).toBe(200)
      const [header, values] = payload.split('\n')
      expect(header.split(',')).toEqual([
        'reference',
        'businessName',
        'mainCustomer'
      ])
      expect(values.split(',')).toEqual([
        'PPP-A1B-2C3',
        'Pesticides Ltd',
        'Farmers'
      ])
    })

    test('does not expose the mongo _id', async () => {
      const { payload } = await getExport('/export?reference=PPP-A1B-2C3')
      expect(payload).not.toContain('_id')
    })

    test('the route is unauthenticated while auth is deferred', async () => {
      // The TODO in exports.js has auth commented out until e2e is ready; this
      // test fails the moment requireRole is re-enabled, as a reminder to add
      // the 401/403 cases the operators routes already have.
      const { statusCode } = await getExport('/export?reference=PPP-A1B-2C3')
      expect(statusCode).toBe(200)
    })

    // --- Documented gaps ---------------------------------------------------
    // These tests pin CURRENT behaviour, not desired behaviour, so the gaps are
    // visible and a fix has to update a test rather than pass silently.

    test('serves CSV as text/html with no download headers', async () => {
      const { headers } = await getExport('/export?reference=PPP-A1B-2C3')
      // The handler returns a bare string, so hapi infers text/html. Compare
      // /operators/export, which sets text/csv + content-disposition.
      expect(headers['content-type']).toContain('text/html')
      expect(headers['content-disposition']).toBeUndefined()
    })

    test('500, not 404, when the reference does not exist', async () => {
      // exportOneToCsv(null) throws; the handler never checks for a miss.
      const { statusCode } = await getExport('/export?reference=PPP-ZZZ-999')
      expect(statusCode).toBe(500)
    })

    test('500, not 400, when the reference query parameter is missing', async () => {
      // The route declares no query validation, so an absent reference reaches
      // Mongo, misses, and fails in the serialiser.
      const { statusCode } = await getExport('/export')
      expect(statusCode).toBe(500)
    })

    test('500, not 400, for a malformed reference number', async () => {
      const { statusCode } = await getExport(
        '/export?reference=not-a-reference'
      )
      expect(statusCode).toBe(500)
    })
  })
})
