import { config } from '#/config.js'

import { STRATEGY_NAME } from './strategy-name.js'

// The configured case-officer role value(s) as an array. `auth.entra.roleValues`
// is a comma-separated string; split + trim it once here so every protected
// route shares one parser instead of copying the snippet — don't pass the raw
// string to requireRole, or 'case_officer,admin' becomes a single literal scope
// that never matches.
export function getCaseOfficerRoles() {
  return config
    .get('auth.entra.roleValues')
    .split(',')
    .map((role) => role.trim())
}

// Reusable RBAC helper for protected routes. Returns the Hapi route `auth`
// options that (a) require a valid Entra bearer token via the entra-bearer
// strategy, and (b) authorise the caller against the given app-role value(s)
// using Hapi's built-in scope check.
//
// A request with no/invalid token gets 401; a valid token whose roles don't
// include any required value gets 403.
//
//   route.options.auth = requireRole(...getCaseOfficerRoles())
//
// Note: Hapi scope matching is case-sensitive, so the configured role value must
// match the Entra app-role value exactly.
export function requireRole(...roles) {
  const scope = roles.flat().filter(Boolean)
  if (scope.length === 0) {
    // Fail loud at route-definition time rather than relying on Hapi's incidental
    // "scope must contain at least 1 item" schema error, which hides the cause
    // (usually an empty ENTRA_CASE_OFFICER_ROLE_VALUES).
    throw new Error(
      'requireRole: at least one role value is required (check ENTRA_CASE_OFFICER_ROLE_VALUES)'
    )
  }
  return {
    strategy: STRATEGY_NAME,
    scope
  }
}
