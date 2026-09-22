import Joi from 'joi'
import Boom from '@hapi/boom'

import { config } from '#/config.js'
import {
  startVerification,
  confirmVerification,
  resendVerification,
  VerificationNotFoundError,
  CodeExpiredError,
  IncorrectCodeError,
  TooManyAttemptsError,
  AlreadyVerifiedError,
  ResendNotAllowedError,
  RateLimitedError,
  EmailSendError
} from '#/services/email-verification/email-verification.js'

const MAX_EMAIL = 254
const HTTP_CREATED = 201

const { codeLength } = config.get('emailVerification')

// Joi's .email() follows RFC 6531 and allows non-ASCII characters (e.g. "£")
// in the local part, so it accepts addresses no real mail provider would.
// Restricting to ASCII local/domain characters closes that gap.
const ASCII_EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/

const emailSchema = Joi.string()
  .trim()
  .email()
  .pattern(ASCII_EMAIL_PATTERN)
  .max(MAX_EMAIL)
  .required()
  .messages({
    'string.empty': 'Enter an email address',
    'string.email': 'Enter a valid email address',
    'string.pattern.base': 'Enter a valid email address',
    'string.max': 'Email address must be 254 characters or less',
    'any.required': 'Enter an email address'
  })

const codeSchema = Joi.string()
  .pattern(/^\d+$/)
  .length(codeLength)
  .required()
  .messages({
    'string.empty': 'Enter the verification code',
    'string.pattern.base': 'Enter a valid verification code',
    'string.length': `Verification code must be ${codeLength} digits`,
    'any.required': 'Enter the verification code'
  })

const verificationIdSchema = Joi.string().hex().length(24).required()

const failWithBadRequest = (_request, _h, err) => {
  throw Boom.badRequest(err.message)
}

// Maps the email-verification service's domain errors onto HTTP responses.
// Kept in the route layer so the service stays HTTP-agnostic, same split as
// the rest of the codebase (services throw plain Errors, routes wrap them).
function mapError(err) {
  if (err instanceof VerificationNotFoundError) {
    return Boom.notFound(err.message)
  }
  // An expired code is deliberately a 400, the same status as an incorrect
  // code. Using 410 here would tell a caller that the verification id is real
  // and only the code lapsed, which is an enumeration signal we do not want to
  // give away.
  if (err instanceof CodeExpiredError) {
    return Boom.badRequest(err.message)
  }
  if (err instanceof IncorrectCodeError) {
    const boom = Boom.badRequest(err.message)
    boom.output.payload.remainingAttempts = err.remainingAttempts
    return boom
  }
  if (err instanceof TooManyAttemptsError) {
    return Boom.tooManyRequests(err.message)
  }
  if (err instanceof AlreadyVerifiedError) {
    return Boom.conflict(err.message)
  }
  if (err instanceof ResendNotAllowedError) {
    const boom = Boom.tooManyRequests(err.message)
    if (err.retryAfter) {
      boom.output.payload.retryAfter = err.retryAfter
    }
    return boom
  }
  if (err instanceof RateLimitedError) {
    return Boom.tooManyRequests(err.message)
  }
  if (err instanceof EmailSendError) {
    return Boom.badGateway(
      'We could not send your verification email. Please try again.'
    )
  }
  return null
}

async function handle(request, action) {
  try {
    return await action()
  } catch (err) {
    const mapped = mapError(err)
    if (mapped) {
      return mapped
    }
    request.log(['error'], err)
    throw Boom.internal('Failed to process email verification')
  }
}

export const emailVerification = [
  {
    method: 'POST',
    path: '/email-verifications',
    options: {
      validate: {
        payload: Joi.object({ email: emailSchema }),
        failAction: failWithBadRequest
      }
    },
    handler: (request, h) =>
      handle(request, async () => {
        const result = await startVerification(request.db, {
          email: request.payload.email,
          ip: request.info.remoteAddress
        })
        return h.response(result).code(HTTP_CREATED)
      })
  },
  {
    method: 'POST',
    path: '/email-verifications/{verificationId}/confirm',
    options: {
      validate: {
        params: Joi.object({ verificationId: verificationIdSchema }),
        payload: Joi.object({ code: codeSchema }),
        failAction: failWithBadRequest
      }
    },
    handler: (request, h) =>
      handle(request, async () => {
        const result = await confirmVerification(request.db, {
          verificationId: request.params.verificationId,
          code: request.payload.code
        })
        return h.response(result)
      })
  },
  {
    method: 'POST',
    path: '/email-verifications/{verificationId}/resend',
    options: {
      validate: {
        params: Joi.object({ verificationId: verificationIdSchema }),
        failAction: failWithBadRequest
      }
    },
    handler: (request, h) =>
      handle(request, async () => {
        const result = await resendVerification(request.db, {
          verificationId: request.params.verificationId,
          ip: request.info.remoteAddress
        })
        return h.response(result).code(HTTP_CREATED)
      })
  }
]
