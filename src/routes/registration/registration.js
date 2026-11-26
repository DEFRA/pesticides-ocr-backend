import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'
import { MAX_REQUEST_ID_LENGTH } from '#/common/constants/history.js'
import { config } from '#/config.js'
import { saveRegistration } from '#/services/registration/registration.js'
import { isEmailVerifiedForJourney } from '#/services/email-verification/registration-gate.js'
import { missingEmailVerificationSettings } from '#/services/email-verification/config-guard.js'
import { normaliseEmail } from '#/services/email-verification/email-address.js'
import { requireJourneyId } from '#/common/helpers/require-journey-id.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { HTTP_CREATED } from '#/common/constants/http-status.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { IDENTITY_TYPE } from '#/auth/strategy-name.js'
import { authorise } from '#/auth/authorise.js'
import { requireSharedAccess } from '#/auth/require-own-registration.js'
import { registrationParamsSchema } from '#/common/helpers/registration-reference.js'
import { failWithBadRequest } from '#/common/helpers/search-query.js'
import { createRegistrationAccessRepository } from '#/repositories/registration-access.js'
import { VersionConflictError } from '#/repositories/version-conflict-error.js'
import {
  patchRegistrationSchema,
  registrationSchema
} from '#/routes/registration/registration-schema.js'
import {
  EMAIL_NOT_VERIFIED,
  SERVICE_NOT_CONFIGURED
} from '#/common/constants/error-codes.js'

const REGISTRATION_NOT_FOUND_MESSAGE = 'Registration not found'

// A PATCH only carries the fields being changed, so validating just those
// would lose the rules that link fields to each other (e.g. usingPPPs is
// required when using PPPs is ticked). Merge the changes into the stored
// record and check the result against the same full schema POST /register
// uses, so a record saved via PATCH is always one POST would have accepted.
const REGISTRATION_FIELDS = Object.keys(registrationSchema.describe().keys)

function assertMergedRegistrationIsValid(current, changes) {
  const stored = Object.fromEntries(
    REGISTRATION_FIELDS.filter((field) => field in current).map((field) => [
      field,
      current[field]
    ])
  )
  const { error } = registrationSchema.validate({ ...stored, ...changes })
  if (error) {
    throw Boom.badRequest(error.message, {
      validation: error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message
      }))
    })
  }
}

// The request ID comes from a header, so one that's empty or too long is
// dropped rather than failing the applicant's submission.
function requestIdFromTrace() {
  const traceId = getTraceId()
  return typeof traceId === 'string' &&
    traceId !== '' &&
    traceId.length <= MAX_REQUEST_ID_LENGTH
    ? traceId
    : undefined
}

// The primary contact email must have been verified by magic link for the
// submitting journey: 401 without a valid x-journey-token, 503 if any email
// verification setting is missing on this tier, 403 with no recent
// verification. Skipped only on a tier that has turned the gate off for its
// frontend to catch up.
async function requireVerifiedContactEmail(request) {
  if (!config.get('emailVerification.requiredForRegistration')) {
    return
  }

  if (missingEmailVerificationSettings().length > 0) {
    throw withErrorCode(
      Boom.serverUnavailable('Email verification is not configured'),
      SERVICE_NOT_CONFIGURED
    )
  }

  const journeyId = requireJourneyId(request)

  let verified
  try {
    verified = await isEmailVerifiedForJourney(request.db, {
      journeyId,
      email: request.payload.primaryContact.contactEmail
    })
  } catch (err) {
    request.log(['error'], err)
    throw Boom.internal('Failed to check email verification')
  }

  if (!verified) {
    throw withErrorCode(
      Boom.forbidden('The contact email address has not been verified'),
      EMAIL_NOT_VERIFIED
    )
  }
}

export const register = [
  {
    method: 'POST',
    path: '/register',
    options: {
      validate: {
        payload: registrationSchema.required(),
        failAction: async (_request, _h, err) => {
          throw Boom.badRequest(err.message, {
            validation: err.details.map((d) => ({
              field: d.path.join('.'),
              message: d.message
            }))
          })
        }
      }
    },
    handler: async (request, h) => {
      await requireVerifiedContactEmail(request)

      try {
        const result = await saveRegistration(
          request.registrations,
          request.payload,
          { requestId: requestIdFromTrace() }
        )
        return h.response({ reference: result.reference }).code(HTTP_CREATED)
      } catch (err) {
        request.log(['error'], err)
        throw Boom.internal('Failed to save registration')
      }
    }
  },
  // Shared route: both verified external applicants (external-bearer) and
  // case officers/admins (entra-bearer) can reach GET/PATCH
  // /registrations/{reference} — requireSharedAccess accepts either
  // strategy, and authorise() then applies the record-level rule for
  // whichever population actually authenticated (AC2-AC5 for external
  // users; case-officer roles are dataset-scoped already, see
  // requireInternalPermission). Role alone is never enough on its own.
  {
    method: 'GET',
    path: '/registrations/{reference}',
    options: {
      auth: requireSharedAccess(),
      validate: {
        params: registrationParamsSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { reference } = request.params
      await authorise(request, { action: 'registration:read', reference })

      const registration =
        await request.registrations.findByReference(reference)
      // Ownership/permission was already confirmed, so a missing
      // registration here is an internal inconsistency, not an
      // authorisation failure — but the response stays generic either way,
      // per AC4/AC5 (no data leakage).
      if (!registration) {
        throw Boom.notFound(REGISTRATION_NOT_FOUND_MESSAGE)
      }
      return h.response(registration)
    }
  },
  {
    method: 'PATCH',
    path: '/registrations/{reference}',
    options: {
      auth: requireSharedAccess(),
      validate: {
        params: registrationParamsSchema,
        payload: patchRegistrationSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { reference } = request.params
      await authorise(request, { action: 'registration:update', reference })

      const { identityType, subject } = request.auth.credentials
      const { version, reason, ...changes } = request.payload

      // Confirmed decision (completion ticket AC6): changing the contact
      // email must not carry over the old email's entitlement. Every
      // existing grant on this registration (for every identity, not just
      // the caller's) is revoked in the same transaction as the update; the
      // new email must re-verify — via the normal
      // POST /email-verifications(/verify) flow with this reference —
      // before anyone can access the registration again. Revocation only
      // happens when the stored email actually changes (compared normalised),
      // so editing the contact's name or phone number doesn't lock the
      // applicant out. Dotted keys are rejected by patchRegistrationSchema, so this can
      // read the nested value directly.
      const newContactEmail = changes.primaryContact?.contactEmail

      const actor = {
        type:
          identityType === IDENTITY_TYPE.EXTERNAL
            ? ACTOR_TYPE.EXTERNAL_USER
            : ACTOR_TYPE.CASE_OFFICER,
        id: subject
      }

      try {
        const updated = await request.registrations.withTransaction(
          async (session) => {
            const current = await request.registrations.findByReference(
              reference,
              { session }
            )
            if (!current) {
              throw Boom.notFound(REGISTRATION_NOT_FOUND_MESSAGE)
            }
            // A stale version is left to update() below, which reports it as
            // a 409 — validating a merge built on out-of-date data would
            // give a misleading 400.
            if (current.version === version) {
              assertMergedRegistrationIsValid(current, changes)
            }
            const changingContactEmail =
              typeof newContactEmail === 'string' &&
              normaliseEmail(newContactEmail) !==
                normaliseEmail(current.primaryContact?.contactEmail)

            const result = await request.registrations.update(
              reference,
              changes,
              {
                by: actor,
                reason,
                expectedVersion: version,
                requestId: requestIdFromTrace(),
                session
              }
            )
            // Revoking in the same transaction as the update means a failure
            // partway through never leaves the old email still holding
            // access: either both the update and the revocation commit, or
            // neither does.
            if (result && changingContactEmail) {
              const accessRepository = createRegistrationAccessRepository({
                db: request.db
              })
              await accessRepository.revokeAllForReference(reference, {
                session
              })
            }
            return result
          }
        )
        if (!updated) {
          throw Boom.notFound(REGISTRATION_NOT_FOUND_MESSAGE)
        }
        return h.response(updated)
      } catch (err) {
        if (err instanceof VersionConflictError) {
          throw Boom.conflict(
            'The registration has changed since it was loaded. Reload it and try again.'
          )
        }
        if (err.isBoom) {
          throw err
        }
        request.log(['error'], err)
        throw Boom.internal('Failed to update registration')
      }
    }
  }
]
