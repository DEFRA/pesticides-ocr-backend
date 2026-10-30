export const FIRST_VERSION = 1
// A registration stored before versions were added has no version field, and
// counts as this version.
export const UNVERSIONED = 0

export const HISTORY_OPERATION = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete'
})

export const HISTORY_VERSION_INDEX = Object.freeze({
  key: { reference: 1, version: 1 },
  options: { unique: true }
})

export const MAX_REASON_LENGTH = 500
export const MAX_REQUEST_ID_LENGTH = 200
export const MAX_BY_ID_LENGTH = 200
