// Registration fields that only a soft delete may set.
export const LIFECYCLE_FIELDS = [
  'isDeleted',
  'deletedAt',
  'deletedBy',
  'deletionReason'
]
