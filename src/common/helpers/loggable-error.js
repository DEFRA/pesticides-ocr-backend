import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'

// A duplicate key error quotes the clashing key in its message, keyValue and
// errorResponse, and that key can be a token hash or an email hash. Such an
// error is logged by name and code only; any other error is logged as it is.
export function loggableError(error) {
  if (error?.code !== MONGO_DUPLICATE_KEY_ERROR) {
    return error
  }
  const safe = new Error('Duplicate key error')
  safe.name = error.name
  safe.code = error.code
  return safe
}
