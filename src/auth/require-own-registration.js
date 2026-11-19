import Boom from '@hapi/boom'

import { EXTERNAL_USER_ROLE } from '#/common/constants/roles.js'
import { createRegistrationAccessRepository } from '#/repositories/registration-access.js'
import { EXTERNAL_STRATEGY_NAME, STRATEGY_NAME } from './strategy-name.js'
import { getCaseOfficerRoles } from './require-role.js'

// Route `auth` options for a *shared* route: both case officers (entra-bearer)
// and verified external users (external-bearer) may authenticate. Which of
// them is actually allowed to proceed is then decided per-record by
// authorise() below — role alone is never enough on its own for either
// population once a route is shared.
export function requireSharedAccess() {
  return {
    strategies: [STRATEGY_NAME, EXTERNAL_STRATEGY_NAME],
    scope: [EXTERNAL_USER_ROLE, ...getCaseOfficerRoles()]
  }
}

// Route `auth` options for routes external users can reach: authenticate via
// the external-access-token strategy and require the external_user scope.
// Pair this with requireOwnRegistration (called from the handler) to also
// enforce record-level ownership — role alone is not enough for this
// population, unlike the internal roles which are dataset-scoped.
export function requireExternalUser() {
  return {
    strategy: EXTERNAL_STRATEGY_NAME,
    scope: [EXTERNAL_USER_ROLE]
  }
}

// Record-level authorisation for external users. Call this from a route
// handler, after requireExternalUser has authenticated the caller, passing
// the registration reference the request targets (e.g. from request.params).
//
// Fails closed and generic on any mismatch: a 403 Boom with no detail about
// whether the record exists, so a caller probing references can't learn
// anything about other people's registrations (AC4/AC5).
export async function requireOwnRegistration(request, reference) {
  const { credentials } = request.auth
  // Cheap check first: the token's own claim, set at issue time, already
  // names a single reference — but this must ALSO be checked against the
  // persisted grant below, so a stale or revoked grant can't still be used
  // for the lifetime of the token.
  if (credentials.registrationReference !== reference) {
    throw Boom.forbidden('Not authorised to access this registration')
  }

  const repository = createRegistrationAccessRepository({ db: request.db })
  const permitted = await repository.isPermitted(credentials.subject, reference)
  if (!permitted) {
    throw Boom.forbidden('Not authorised to access this registration')
  }
}

// Record-level authorisation for internal (case-officer/admin) users on a
// shared route. Role-level access was already confirmed by requireSharedAccess
// (the caller's token carries one of the configured case-officer roles); this
// is a placeholder seam for future jurisdiction/dataset scoping (e.g. a case
// officer restricted to a subset of registrations). Until that lands, any
// caller with a valid case-officer role may act on any registration.
export function requireInternalPermission(_request, _action) {
  // Intentionally a no-op today — see §6 "internal jurisdiction scope" open
  // question. Kept as an explicit function (not inlined in authorise) so the
  // future scoping check has a single place to land.
}
