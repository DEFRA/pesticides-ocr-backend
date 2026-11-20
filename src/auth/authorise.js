import Boom from '@hapi/boom'

import { IDENTITY_TYPE } from './strategy-name.js'
import {
  requireInternalPermission,
  requireOwnRegistration
} from './require-own-registration.js'

// Single entry point for authorising a *shared* route (one that both case
// officers and verified external users may reach, e.g. GET/PATCH
// /registrations/{reference} — see requireSharedAccess). Dispatches on
// identityType (set identically by both bearer schemes, see
// entra-bearer-scheme.js / external-bearer-scheme.js) so the route itself
// never has to know which strategy authenticated the caller.
//
// Call this first in the handler, after the route's `auth` option has
// already confirmed the caller holds a recognised role (requireSharedAccess).
// Role alone is still never enough — this layers the record-level check on
// top, same principle as the original external-only requireOwnRegistration.
export async function authorise(request, { action, reference }) {
  const { identityType } = request.auth.credentials

  if (identityType === IDENTITY_TYPE.EXTERNAL) {
    return requireOwnRegistration(request, reference)
  }
  if (identityType === IDENTITY_TYPE.INTERNAL) {
    return requireInternalPermission(request, action)
  }
  // Defensive: should be unreachable given requireSharedAccess only accepts
  // the two strategies above, but fails closed and generic either way.
  throw Boom.forbidden('Not authorised to access this registration')
}
