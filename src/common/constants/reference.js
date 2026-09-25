// A registration reference is <prefix>-XXX-XXX: a configured prefix followed by
// two three-character groups.
export const REFERENCE_SUFFIX_LENGTH = '-XXX-XXX'.length

// Longest reference /search accepts. A reference with the default prefix is 11
// characters, so this is already generous; the reference-prefix config format
// derives its own bound from it, so a configured prefix can never produce a
// reference that search rejects as too long.
export const MAX_REFERENCE_LENGTH = 32
