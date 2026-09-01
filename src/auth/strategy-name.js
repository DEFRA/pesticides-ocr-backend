// The Hapi auth scheme + strategy name (they share it). Referenced by the plugin
// that registers it and the requireRole helper (own module to avoid a cycle).
export const STRATEGY_NAME = 'entra-bearer'
