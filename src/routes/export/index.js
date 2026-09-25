import Boom from '@hapi/boom'

import { config } from '#/config.js'
import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
import {
  searchQuerySchema,
  failWithBadRequest,
  noStoreCache
} from '#/common/helpers/search-query.js'
import { resolveQuery } from '#/services/search/search.js'
import { exportToCsv } from '#/services/export/index.js'

// GET /export (EQ-369) — the same question as /search, answered as a CSV
// download. It takes the identical query contract, so a reference exports one
// record and a free-text term exports every match.
//
// The route is the composition point: it asks search for rows, then hands them
// to the export service. Neither service imports the other.
//
// Unlike /search this isn't capped at a page, because an export truncated at a
// page boundary would be quietly wrong. But the rows and the CSV are built in
// memory, so it is bounded by `export.maxRows`: a match larger than that is
// refused with a 400 asking the caller to narrow the search, never cut short.
// One extra row is read to tell "exactly the limit" from "over it". The limit
// is at least 1 (positive-int config format), so there is no "0 = unlimited"
// or "0 = disabled" case to get wrong. Streaming the CSV would lift the bound;
// that is the EQ-385 hardening follow-up.
export const exportRegistrations = [
  {
    method: 'GET',
    path: '/export',
    options: {
      auth: requireRole(...getCaseOfficerRoles()),
      cache: noStoreCache,
      validate: {
        query: searchQuerySchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const maxRows = config.get('export.maxRows')
      const result = await resolveQuery(request.db, request.query, {
        limit: maxRows + 1
      })

      if (result.invalidReference) {
        return Boom.badRequest('Invalid reference number')
      }

      const { subject, roles } = request.auth.credentials

      if (result.list?.length > maxRows) {
        // Audited too, so refusals show whether EXPORT_MAX_ROWS needs tuning.
        request.log(
          ['export', 'audit'],
          `registrations export refused: subject=${subject} roles=${roles} over maxRows=${maxRows}`
        )
        return Boom.badRequest(
          `The export is limited to ${maxRows} registrations. Narrow the search and try again.`
        )
      }

      // A reference that matches nothing exports an empty file rather than
      // 404ing — the request was valid, the answer is just no rows.
      const rows = result.list ?? (result.single ? [result.single] : [])
      const { csv, rowCount } = exportToCsv(rows)

      // Audit the bulk PII download without logging the data itself: who, how
      // many rows, and whether a filter was applied (not the term — it may be
      // a name).
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
    }
  }
]
