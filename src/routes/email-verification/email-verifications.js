import Joi from 'joi'
import Boom from '@hapi/boom'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { loggableError } from '#/common/helpers/loggable-error.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import {
  optionalJourneyId,
  requireJourneyId
} from '#/common/helpers/require-journey-id.js'
import { HTTP_ACCEPTED } from '#/common/constants/http-status.js'
import { MAX_EMAIL_LENGTH } from '#/common/constants/email.js'
import {
  EMAIL_SEND_FAILED,
  RATE_LIMITED,
  RESEND_COOLDOWN,
  SERVICE_NOT_CONFIGURED,
  TOKEN_ALREADY_USED,
  TOKEN_EXPIRED,
  TOKEN_INVALID,
  TOKEN_SUPERSEDED,
  VALIDATION_ERROR,
  VERIFICATION_FAILED
} from '#/common/constants/error-codes.js'
import { NotifySendError } from '#/services/notify/notify.js'
import { missingEmailVerificationSettings } from '#/services/email-verification/config-guard.js'
import { currentVerificationStatus } from '#/services/email-verification/current-status.js'
import { normalisedEmailSchema } from '#/services/email-verification/email-address.js'
import { isLinkTokenFormat } from '#/services/email-verification/link-token.js'
import { LIMITS } from '#/services/email-verification/rate-limiter.js'
import { requestVerificationLink } from '#/services/email-verification/request-link.js'
import {
  recordVerifyRejected,
  verifyLinkToken
} from '#/services/email-verification/verify-link.js'

const logger = createLogger()

// Public: the applicant journey has no bearer token. The signed journey token
// binds the request to a session instead, so the body only needs the address.
const MAX_PAYLOAD_BYTES = 1024

// Stored and compared trimmed and lower-cased. Unknown keys are rejected.
const payloadSchema = Joi.object({
  email: normalisedEmailSchema
    .max(MAX_EMAIL_LENGTH)
    .email({ tlds: false })
    .required()
})

// Anything but a 43-character base64url token is refused before the database
// is queried.
const verifyPayloadSchema = Joi.object({
  token: Joi.string()
    .required()
    .custom((value, helpers) =>
      isLinkTokenFormat(value) ? value : helpers.error('any.invalid')
    )
})

// The server-wide failAction logs the whole Joi error, whose details hold the
// submitted address or token, so log only which fields failed and how.
const validationSummary = (error) =>
  (error.details ?? []).map(({ path, type }) => ({
    field: path.join('.'),
    type
  }))

function failValidation(_request, _h, error) {
  logger.warn(
    { validation: validationSummary(error) },
    'Invalid email verification request'
  )
  throw withErrorCode(
    Boom.badRequest('Invalid request payload input'),
    VALIDATION_ERROR
  )
}

function failVerifyValidation(request, _h, error) {
  logger.warn(
    { validation: validationSummary(error) },
    'Invalid email verification link'
  )
  recordVerifyRejected({
    journeyId: optionalJourneyId(request),
    code: TOKEN_INVALID
  })
  throw withErrorCode(Boom.badRequest('Invalid link token'), TOKEN_INVALID)
}

function requireConfigured() {
  if (missingEmailVerificationSettings().length > 0) {
    throw withErrorCode(
      Boom.serverUnavailable('Email verification is not configured'),
      SERVICE_NOT_CONFIGURED
    )
  }
}

// The cooldown gets its own code so the frontend can say how long to wait.
// Every cap shares RATE_LIMITED, so the caller can't tell which one was hit.
function rateLimitedError({ limit, retryAfterSeconds }) {
  const error =
    limit === LIMITS.COOLDOWN
      ? withErrorCode(
          Boom.tooManyRequests(
            'Wait before requesting another verification email.'
          ),
          RESEND_COOLDOWN
        )
      : withErrorCode(
          Boom.tooManyRequests(
            'Too many verification emails have been requested. Try again later.'
          ),
          RATE_LIMITED
        )
  error.output.headers['Retry-After'] = String(retryAfterSeconds)
  return error
}

// Why a link didn't verify, as the status and code the frontend branches on.
// TOKEN_ALREADY_USED also says whether it was this journey's, so the browser
// that started the journey can carry on.
function verifyRejectedError({ code, sameJourney }) {
  switch (code) {
    case TOKEN_EXPIRED:
      return withErrorCode(Boom.resourceGone('Link has expired'), code)
    case TOKEN_SUPERSEDED:
      return withErrorCode(
        Boom.resourceGone('Link has been replaced by a newer one'),
        code
      )
    case TOKEN_ALREADY_USED: {
      const error = withErrorCode(
        Boom.conflict('Link has already been used'),
        code
      )
      error.output.payload.sameJourney = sameJourney
      return error
    }
    default:
      return withErrorCode(Boom.notFound('Link is not valid'), TOKEN_INVALID)
  }
}

const isoOrNull = (date) => date?.toISOString() ?? null

// POST /email-verifications: request or resend a magic link.
// POST /email-verifications/verify: use up a link.
// GET /email-verifications/current: the journey's latest link.
// No response carries an email address, token or record id.
export const emailVerifications = [
  {
    method: 'POST',
    path: '/email-verifications',
    options: {
      payload: { maxBytes: MAX_PAYLOAD_BYTES },
      validate: {
        payload: payloadSchema,
        failAction: failValidation
      }
    },
    handler: async (request, h) => {
      requireConfigured()
      const journeyId = requireJourneyId(request)

      let result
      try {
        result = await requestVerificationLink(
          { client: request.server.mongoClient, db: request.db },
          { journeyId, email: request.payload.email }
        )
      } catch (error) {
        if (error instanceof NotifySendError) {
          throw withErrorCode(
            Boom.badGateway('The verification email could not be sent'),
            EMAIL_SEND_FAILED
          )
        }
        logger.error(loggableError(error), 'Email verification request failed')
        throw Boom.internal('Failed to request email verification')
      }

      if (!result.sent) {
        throw rateLimitedError(result)
      }

      return h
        .response({
          expiresAt: result.expiresAt.toISOString(),
          resendAvailableAt: result.resendAvailableAt.toISOString()
        })
        .code(HTTP_ACCEPTED)
    }
  },
  {
    method: 'POST',
    path: '/email-verifications/verify',
    options: {
      payload: { maxBytes: MAX_PAYLOAD_BYTES },
      validate: {
        payload: verifyPayloadSchema,
        failAction: failVerifyValidation
      }
    },
    handler: async (request, h) => {
      let result
      try {
        result = await verifyLinkToken(request.db, {
          token: request.payload.token,
          journeyId: optionalJourneyId(request)
        })
      } catch (error) {
        logger.error(loggableError(error), 'Email verification failed')
        throw withErrorCode(
          Boom.internal('Failed to verify email'),
          VERIFICATION_FAILED
        )
      }

      if (!result.verified) {
        throw verifyRejectedError(result)
      }

      return h.response({
        outcome: 'VERIFIED',
        sameJourney: result.sameJourney
      })
    }
  },
  {
    method: 'GET',
    path: '/email-verifications/current',
    handler: async (request, h) => {
      const journeyId = requireJourneyId(request)

      let current
      try {
        current = await currentVerificationStatus(request.db, { journeyId })
      } catch (error) {
        logger.error(error, 'Email verification status failed')
        throw Boom.internal('Failed to read email verification status')
      }

      return h.response({
        status: current.status,
        expiresAt: isoOrNull(current.expiresAt),
        verifiedAt: isoOrNull(current.verifiedAt),
        resendAvailableAt: isoOrNull(current.resendAvailableAt)
      })
    }
  }
]
