import { STRATEGY_NAME } from './strategy-name.js'

// Reusable RBAC helper for protected routes. Returns the Hapi route `auth`
// options that (a) require a valid Entra bearer token via the entra-bearer
// strategy, and (b) authorise the caller against the given app-role value(s)
// using Hapi's built-in scope check.
//
// A request with no/invalid token gets 401; a valid token whose roles don't
// include any required value gets 403.
//
//   route.options.auth = requireRole('case_officer')
//   route.options.auth = requireRole(config.get('auth.entra.roleValues'))
//
// Note: Hapi scope matching is case-sensitive, so the configured role value must
// match the Entra app-role value exactly.
export function requireRole(...roles) {
  const scope = roles.flat().filter(Boolean)
  if (scope.length === 0) {
    // Fail loud at route-definition time rather than relying on Hapi's incidental
    // "scope must contain at least 1 item" schema error, which hides the cause
    // (usually an empty ENTRA_CASE_OFFICER_ROLE_VALUE).
    throw new Error(
      'requireRole: at least one role value is required (check ENTRA_CASE_OFFICER_ROLE_VALUE)'
    )
  }
  return {
    strategy: STRATEGY_NAME,
    scope
  }
}
