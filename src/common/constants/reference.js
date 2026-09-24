// A registration reference is <prefix>-XXX-XXX: a configured prefix followed by
// two three-character groups.
export const REFERENCE_SUFFIX_LENGTH = '-XXX-XXX'.length

// Longest reference /search accepts. A reference with the default prefix is 11
// characters, so this is already generous; the reference-prefix config format
// derives its own bound from it, so a configured prefix can never produce a
// reference that search rejects as too long.
export const MAX_REFERENCE_LENGTH = 32

// Prefix on references the local seed script generates (SED-XXX-XXX), so seeded
// records are distinguishable from real ones and can be deleted in bulk. Shared
// with the search validator so seeded records stay searchable in development.
export const SEED_REFERENCE_PREFIX = 'SED'
