// The Hapi auth scheme + strategy name (they share it). Referenced by the plugin
// that registers it and the requireRole helper (own module to avoid a cycle).
export const STRATEGY_NAME = 'entra-bearer'

// Strategy for the external-user access token issued after email
// verification (see external-bearer-scheme.js).
export const EXTERNAL_STRATEGY_NAME = 'external-bearer'
