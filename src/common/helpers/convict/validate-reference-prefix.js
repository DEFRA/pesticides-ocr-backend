import {
  MAX_REFERENCE_LENGTH,
  REFERENCE_SUFFIX_LENGTH
} from '#/common/constants/reference.js'

// A reference is <prefix>-XXX-XXX in upper-case alphanumerics, and /search
// validates references in that shape and length. Constraining the prefix to the
// same alphabet, and short enough that a whole reference fits /search's bound,
// means a misconfigured REFERENCE_PREFIX fails at startup, rather than
// generating references that search then rejects.
const MAX_PREFIX_LENGTH = MAX_REFERENCE_LENGTH - REFERENCE_SUFFIX_LENGTH
const REFERENCE_PREFIX_PATTERN = new RegExp(
  `^[A-Z0-9]{1,${MAX_PREFIX_LENGTH}}$`
)

export const convictValidateReferencePrefix = {
  name: 'reference-prefix',
  validate: function validateReferencePrefix(value) {
    if (!REFERENCE_PREFIX_PATTERN.test(value)) {
      throw new Error(
        `must be 1 to ${MAX_PREFIX_LENGTH} upper-case letters or digits`
      )
    }
  }
}
