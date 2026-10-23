// When the registration was submitted: its creation time.
export const SUBMITTED_AT = 'submittedAt'

// Registration fields that only a soft delete may set.
export const LIFECYCLE_FIELDS = [
  'isDeleted',
  'deletedAt',
  'deletedBy',
  'deletionReason'
]
