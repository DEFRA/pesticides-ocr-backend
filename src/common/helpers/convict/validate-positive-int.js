// A whole number of at least 1. For limits where 0 would be a trap rather than
// a setting: it reads as "no limit" to some callers (Mongo's limit(0)) and as
// "allow nothing" to others, so it's refused at startup instead of being given
// a meaning.
export const convictValidatePositiveInt = {
  name: 'positive-int',
  validate: function validatePositiveInt(value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('must be a whole number of at least 1')
    }
  },
  // Number, not parseInt, so '10abc' fails validation rather than becoming 10.
  coerce: Number
}
