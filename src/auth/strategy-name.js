// The Hapi auth scheme + strategy name (they share it). Referenced by the plugin
// that registers it and the requireRole helper (own module to avoid a cycle).
export const STRATEGY_NAME = 'entra-bearer'

// Strategy for the external-user access token issued after email
// verification (see external-bearer-scheme.js).
export const EXTERNAL_STRATEGY_NAME = 'external-bearer'

// Credential discriminator shared by both auth schemes (see
// entra-bearer-scheme.js / external-bearer-scheme.js). Lets shared-route
// handlers (e.g. GET/PATCH /registrations/{reference}) branch on who is
// calling without caring which strategy authenticated the request.
export const IDENTITY_TYPE = {
  INTERNAL: 'internal',
  EXTERNAL: 'external'
}
