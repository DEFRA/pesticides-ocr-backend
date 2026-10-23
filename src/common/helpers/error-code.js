// Adds a stable `code` to a Boom error's response body, alongside statusCode,
// error and message.
export function withErrorCode(boom, code) {
  boom.output.payload.code = code
  return boom
}
