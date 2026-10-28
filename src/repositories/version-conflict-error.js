import { VERSION_CONFLICT } from '#/common/constants/error-codes.js'

// The registration exists, but has changed since the caller loaded it.
export class VersionConflictError extends Error {
  constructor({ reference, expectedVersion, currentVersion }) {
    super(
      `Registration ${reference} is at version ${currentVersion}, not ${expectedVersion}`
    )
    this.name = 'VersionConflictError'
    this.code = VERSION_CONFLICT
    this.reference = reference
    this.expectedVersion = expectedVersion
    this.currentVersion = currentVersion
  }
}
