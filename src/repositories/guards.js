// A non-string reference could be a query operator, like { $ne: '' }, that
// matches someone else's registration.
export function assertReference(reference) {
  if (typeof reference !== 'string') {
    throw new TypeError('reference must be a string')
  }
}

// Mongo treats a missing or 0 limit as no limit at all.
export function assertLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer')
  }
}

export function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
}
