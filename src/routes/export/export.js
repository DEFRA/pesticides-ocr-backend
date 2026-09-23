import Boom from '@hapi/boom'

import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchQuerySchema,
  failWithBadRequest
} from '#/common/helpers/search-query.js'
import { resolveQuery } from '#/services/search/search.js'
import { exportToCsv } from '#/services/export/export.js'

// GET /export (EQ-369) — the same question as /search, answered as a CSV
// download. It takes the identical query contract, so a reference exports one
// record and a free-text term exports every match.
//
// The route is the composition point: it asks search for rows, then hands them
// to the export service. Neither service imports the other.
//
// Unlike /search this is uncapped (limit 0 = Mongo's "no cap"), because an
// export truncated at a page boundary would be quietly wrong.
//
// POC caveat: that uncapped read buffers every matching row and builds the
// whole CSV in memory. Fine at POC volumes; before this holds production data,
// add a hard ceiling (e.g. MAX_EXPORT_ROWS) and/or stream the CSV. Tracked on
// the EQ-385 hardening follow-up.
const NO_CAP = 0

export const exportRegistrations = [
  {
    method: 'GET',
    path: '/export',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      validate: {
        query: searchQuerySchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const result = await resolveQuery(request.db, request.query, {
        limit: NO_CAP
      })

      if (result.invalidReference) {
        return Boom.badRequest('Invalid reference number')
      }

      // A reference that matches nothing exports an empty file rather than
      // 404ing — the request was valid, the answer is just no rows.
      const rows = result.list ?? (result.single ? [result.single] : [])
      const { csv, rowCount } = exportToCsv(rows)

      // Audit the bulk PII download without logging the data itself: who, how
      // many rows, and whether a filter was applied (not the term — it may be
      // a name).
      const { subject, roles } = request.auth.credentials
      request.log(
        ['export', 'audit'],
        `registrations export: subject=${subject} roles=${roles} rows=${rowCount} filtered=${Boolean(
          request.query.reference ?? request.query.q
        )}`
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
