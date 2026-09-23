// Prefix on references the local seed script generates (SED-XXX-XXX), so seeded
// records are distinguishable from real ones and can be deleted in bulk. Shared
// with the search validator so seeded records stay searchable in development.
export const SEED_REFERENCE_PREFIX = 'SED'
