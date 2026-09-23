import { exportOperators } from '#/services/operators/export/export.js'
import { searchRouteOptions } from './helpers/route-options.js'

// GET /operators/export — the (filtered) operators as a CSV download (EQ-369).
// Same search + auth as the list route. A static path, so Hapi matches it ahead
// of /operators/{reference} regardless of registration order. Unlike the paged
// grid the export is the full matching set; an empty result yields the header
// row only.
export const operatorsExport = [
  {
    method: 'GET',
    path: '/operators/export',
    options: searchRouteOptions,
    handler: async (request, h) => {
      const { csv, rowCount } = await exportOperators(request.db, {
        query: request.query.search
      })
      // Audit the bulk PII download without logging the data itself: who, how
      // many rows, and whether a filter was applied (not the term — it may be a name).
      const { subject, roles } = request.auth.credentials
      request.log(
        ['operators', 'export', 'audit'],
        `operators export: subject=${subject} roles=${roles} rows=${rowCount} filtered=${Boolean(request.query.search)}`
      )
      return h
        .response(csv)
        .type('text/csv; charset=utf-8')
        .header(
          'content-disposition',
          'attachment; filename="ocr-registrations.csv"'
        )
        .header('cache-control', 'no-store')
    }
  }
]
