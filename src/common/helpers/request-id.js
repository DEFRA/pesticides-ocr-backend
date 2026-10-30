import { getTraceId } from '@defra/hapi-tracing'
import { MAX_REQUEST_ID_LENGTH } from '#/common/constants/history.js'

// The request ID comes from a header, so one that's empty or too long is
// dropped rather than failing the change it belongs to.
export function requestIdFromTrace() {
  const traceId = getTraceId()
  return typeof traceId === 'string' &&
    traceId !== '' &&
    traceId.length <= MAX_REQUEST_ID_LENGTH
    ? traceId
    : undefined
}
