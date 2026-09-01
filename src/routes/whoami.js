import { config } from '#/config.js'
import { requireRole } from '#/auth/require-role.js'

// Diagnostic endpoint demonstrating the EQ-413 auth foundation: it is protected
// by the entra-bearer strategy and requires the configured case-officer role, and
// echoes back who the verified caller is. A real protected resource (e.g. the
// search API) reuses the same `requireRole(...)` route auth.
const roleValues = config
  .get('auth.entra.roleValues')
  .split(',')
  .map((role) => role.trim())

export const whoami = {
  method: 'GET',
  path: '/whoami',
  options: {
    auth: requireRole(...roleValues)
  },
  handler: (request, h) => {
    const { subject, name, roles } = request.auth.credentials
    return h.response({ subject, name, roles })
  }
}
