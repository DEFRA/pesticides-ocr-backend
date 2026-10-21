import Boom from '@hapi/boom'

import { config } from '#/config.js'
import { JOURNEY_TOKEN_HEADER } from '#/common/constants/journey-token.js'
import {
  JOURNEY_TOKEN_INVALID,
  SERVICE_NOT_CONFIGURED
} from '#/common/constants/error-codes.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { verifiedNonce } from '#/services/metrics/helpers/journey-token.js'

// Returns the journey id: the verified nonce from the signed x-journey-token
// header. Unlike the metrics beacons this fails closed. With no secret
// configured nothing can be verified, so the request is refused (503) rather
// than accepted unsigned.
export function requireJourneyId(request) {
  const secret = config.get('journeyToken.secret')
  if (!secret) {
    throw withErrorCode(
      Boom.serverUnavailable('Journey verification is not configured'),
      SERVICE_NOT_CONFIGURED
    )
  }

  const journeyId = verifiedNonce(request.headers[JOURNEY_TOKEN_HEADER], secret)
  if (!journeyId) {
    throw withErrorCode(
      Boom.unauthorized('Invalid or missing journey token'),
      JOURNEY_TOKEN_INVALID
    )
  }

  return journeyId
}

// The journey id when x-journey-token is present and validly signed, otherwise
// null. For endpoints where the token only adds context, such as verifying a
// link opened in another browser, so a missing secret refuses nothing either.
export function optionalJourneyId(request) {
  return verifiedNonce(
    request.headers[JOURNEY_TOKEN_HEADER],
    config.get('journeyToken.secret')
  )
}
