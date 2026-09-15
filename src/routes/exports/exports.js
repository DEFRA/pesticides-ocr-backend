import { exportOneToCsv } from '#/services/export/export.js'
import { getOneByReferenceNumber } from '#/services/search/search.js'
// TODO: re-enable auth one e2e is ready
// import { requireRole, getCaseOfficerRoles } from '#/auth/require-role.js'
// const roleValues = getCaseOfficerRoles()

export const exports = [
  {
    method: 'GET',
    path: '/export',
    handler: async (request, _h) => {
      return exportOneToCsv(
        await getOneByReferenceNumber(request.db, request.query.reference)
      )
    },
    options: {
      // TODO: re-enable auth one e2e is ready
      // auth: requireRole(...roleValues)
    }
  }
]
