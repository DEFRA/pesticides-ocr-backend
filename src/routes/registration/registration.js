import Joi from 'joi'
import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'
import { MAX_REQUEST_ID_LENGTH } from '#/common/constants/history.js'
import { config } from '#/config.js'
import { saveRegistration } from '#/services/registration/registration.js'
import { isEmailVerifiedForJourney } from '#/services/email-verification/registration-gate.js'
import { missingEmailVerificationSettings } from '#/services/email-verification/config-guard.js'
import {
  normaliseEmail,
  normalisedEmailSchema
} from '#/services/email-verification/email-address.js'
import { requireJourneyId } from '#/common/helpers/require-journey-id.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { HTTP_CREATED } from '#/common/constants/http-status.js'
import { MAX_EMAIL_LENGTH } from '#/common/constants/email.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import { IDENTITY_TYPE } from '#/auth/strategy-name.js'
import { authorise } from '#/auth/authorise.js'
import { requireSharedAccess } from '#/auth/require-own-registration.js'
import { registrationParamsSchema } from '#/common/helpers/registration-reference.js'
import { failWithBadRequest } from '#/common/helpers/search-query.js'
import { createRegistrationAccessRepository } from '#/repositories/registration-access.js'
import { VersionConflictError } from '#/repositories/version-conflict-error.js'
import {
  EMAIL_NOT_VERIFIED,
  SERVICE_NOT_CONFIGURED
} from '#/common/constants/error-codes.js'
import {
  ADDRESS_REGIONS,
  AGRI_SUBSECTORS,
  AMENITY_SUBSECTORS,
  BUSINESS_ACTIVITIES,
  BUSINESS_ACTIVITY,
  HORTI_SUBSECTORS,
  MEMBER_SCHEMES,
  PROFESSIONAL_SECTOR,
  PROFESSIONAL_SECTORS,
  STORAGE_LOCATION,
  STORAGE_LOCATIONS,
  STORING,
  STORING_VALUES,
  USING_QUANTITIES,
  WHO_APPLIES,
  WHO_APPLIES_VALUES
} from '#/common/constants/registration-answers.js'

const MAX_SHORT_TEXT = 100
const MAX_BUSINESS_NAME = 200
const MAX_INTERNATIONAL_ADDRESS = 500
const MAX_TELEPHONE = 20
const MAX_OWN_STORAGE_ADDRESSES = 20
const REGISTRATION_NOT_FOUND_MESSAGE = 'Registration not found'
const SELECT_COUNTRY_MESSAGE = 'Select a country'

const addressSchema = Joi.object({
  addressLine1: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SHORT_TEXT)
    .required()
    .messages({
      'string.empty': "Enter the first line of your business's address",
      'string.max': 'Address line 1 must be 100 characters or less',
      'any.required': "Enter the first line of your business's address"
    }),
  addressLine2: Joi.string()
    .trim()
    .max(MAX_SHORT_TEXT)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Address line 2 must be 100 characters or less'
    }),
  addressTown: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SHORT_TEXT)
    .required()
    .messages({
      'string.empty': 'Enter town or city',
      'string.max': 'Town or city must be 100 characters or less',
      'any.required': 'Enter town or city'
    }),
  addressCounty: Joi.string()
    .trim()
    .max(MAX_SHORT_TEXT)
    .allow('')
    .optional()
    .messages({
      'string.max': 'County must be 100 characters or less'
    }),
  addressPostcode: Joi.string()
    .trim()
    .pattern(/^[A-Z]{1,2}\d[\dA-Z]?\s?\d[A-Z]{2}$/i)
    .required()
    .messages({
      'string.empty': 'Enter your postcode',
      'string.pattern.base': 'Enter a valid UK postcode',
      'any.required': 'Enter your postcode'
    }),
  addressRegion: Joi.string()
    .valid(...ADDRESS_REGIONS)
    .required()
    .messages({
      'any.only': SELECT_COUNTRY_MESSAGE,
      'string.empty': SELECT_COUNTRY_MESSAGE,
      'any.required': SELECT_COUNTRY_MESSAGE
    })
})

const ENTER_INTERNATIONAL_ADDRESS_MESSAGE = 'Enter your main business address'

const internationalAddressSchema = Joi.object({
  internationalAddress: Joi.string()
    .trim()
    .min(1)
    .max(MAX_INTERNATIONAL_ADDRESS)
    .required()
    .messages({
      'string.empty': ENTER_INTERNATIONAL_ADDRESS_MESSAGE,
      'string.max': 'Business address must be 500 characters or less',
      'any.required': ENTER_INTERNATIONAL_ADDRESS_MESSAGE
    })
})

const mainAddressSchema = Joi.alternatives().conditional(
  Joi.object({ internationalAddress: Joi.exist() }).unknown(),
  { then: internationalAddressSchema, otherwise: addressSchema }
)

const contactSchema = Joi.object({
  contactName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SHORT_TEXT)
    .required()
    .messages({
      'string.empty': 'Enter a contact name',
      'string.max': 'Contact name must be 100 characters or less',
      'any.required': 'Enter a contact name'
    }),
  contactJobTitle: Joi.string()
    .trim()
    .max(MAX_SHORT_TEXT)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Job title or role must be 100 characters or less'
    }),
  contactTelephone: Joi.string()
    .trim()
    .pattern(/^[0-9+()\- ]+$/)
    .min(1)
    .max(MAX_TELEPHONE)
    .required()
    .messages({
      'string.empty': 'Enter a telephone number',
      'string.pattern.base': 'Enter a valid telephone number',
      'string.max': 'Telephone number must be 20 characters or less',
      'any.required': 'Enter a telephone number'
    }),
  contactEmail: normalisedEmailSchema
    .max(MAX_EMAIL_LENGTH)
    .email({ tlds: false })
    .required()
    .messages({
      'string.empty': 'Enter an email address',
      'string.email': 'Enter a valid email address',
      'string.max': 'Email address must be 254 characters or less',
      'any.required': 'Enter an email address'
    })
})

const ENTER_BUSINESS_NAME_MESSAGE = 'Enter the business name'

const contractorSchema = Joi.object({
  contractorName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SHORT_TEXT)
    .required()
    .messages({
      'string.empty': 'Enter the business or company name',
      'string.max': 'Business or company name must be 100 characters or less',
      'any.required': 'Enter the business or company name'
    }),
  address: addressSchema.required()
})

const storageContactSchema = contactSchema.keys({
  businessName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SHORT_TEXT)
    .required()
    .messages({
      'string.empty': ENTER_BUSINESS_NAME_MESSAGE,
      'string.max': 'Business name must be 100 characters or less',
      'any.required': ENTER_BUSINESS_NAME_MESSAGE
    })
})

const codesWithOther = (codes) =>
  Joi.array()
    .items(Joi.string().trim().min(1).max(MAX_SHORT_TEXT))
    .max(codes.length + 1)
    .unique()
    .custom((answers, helpers) =>
      answers.filter((answer) => !codes.includes(answer)).length > 1
        ? helpers.error('array.oneOther')
        : answers
    )
    .messages({ 'array.oneOther': 'Give only one Other answer' })

const includes = (...values) =>
  Joi.array()
    .has(Joi.valid(...values))
    .required()

const askedWhen = (key, is, answer) =>
  answer.when(key, { is, then: Joi.required(), otherwise: Joi.forbidden() })

const amenityOnly = includes(PROFESSIONAL_SECTOR.AMENITY).custom(
  (sectors, helpers) =>
    sectors.includes(PROFESSIONAL_SECTOR.AGRICULTURE) ||
    sectors.includes(PROFESSIONAL_SECTOR.HORTICULTURE)
      ? helpers.error('any.invalid')
      : sectors
)

const SELECT_STORING_MESSAGE = 'Select where the products are stored'

const noneOnItsOwn = (storing, helpers) =>
  storing.includes(STORING.NONE) && storing.length > 1
    ? helpers.error('array.exclusive')
    : storing

const usingPPPsSchema = Joi.object({
  whoApplies: Joi.string()
    .valid(...WHO_APPLIES_VALUES)
    .required()
    .messages({
      'any.only': 'Select who applies PPPs for your organisation',
      'any.required': 'Select who applies PPPs for your organisation'
    }),
  contractor: askedWhen(
    'whoApplies',
    Joi.valid(WHO_APPLIES.CONTRACTOR),
    contractorSchema
  ),
  professionalSectors: codesWithOther(PROFESSIONAL_SECTORS)
    .min(1)
    .required()
    .messages({
      'array.min': 'Select a sector or describe your main type of work',
      'any.required': 'Select a sector or describe your main type of work'
    }),
  agriSubsectors: askedWhen(
    'professionalSectors',
    includes(PROFESSIONAL_SECTOR.AGRICULTURE),
    codesWithOther(AGRI_SUBSECTORS).min(1)
  ),
  amenitySubsectors: askedWhen(
    'professionalSectors',
    includes(PROFESSIONAL_SECTOR.AMENITY),
    codesWithOther(AMENITY_SUBSECTORS).min(1)
  ),
  hortiSubsectors: askedWhen(
    'professionalSectors',
    includes(PROFESSIONAL_SECTOR.HORTICULTURE),
    codesWithOther(HORTI_SUBSECTORS).min(1)
  ),
  memberSchemes: codesWithOther(MEMBER_SCHEMES).when('professionalSectors', {
    is: amenityOnly,
    then: Joi.forbidden(),
    otherwise: Joi.required()
  }),
  storing: Joi.array()
    .items(Joi.string().valid(...STORING_VALUES))
    .min(1)
    .unique()
    .required()
    .custom(noneOnItsOwn)
    .messages({
      'array.min': SELECT_STORING_MESSAGE,
      'any.required': SELECT_STORING_MESSAGE,
      'array.exclusive': `${SELECT_STORING_MESSAGE}, or select 'We do not store PPPs'`
    }),
  storageLocation: askedWhen(
    'storing',
    includes(STORING.OWN),
    Joi.array()
      .items(Joi.string().valid(...STORAGE_LOCATIONS))
      .min(1)
      .unique()
  ),
  ownStorageAddresses: askedWhen(
    'storageLocation',
    includes(STORAGE_LOCATION.ANOTHER_ADDRESS),
    Joi.array().items(addressSchema).min(1).max(MAX_OWN_STORAGE_ADDRESSES)
  ),
  storageContact: askedWhen(
    'storing',
    includes(STORING.THIRD_PARTY),
    storageContactSchema
  ),
  quantity: Joi.string()
    .valid(...USING_QUANTITIES)
    .required()
    .messages({
      'any.only':
        'Select the quantity of PPPs or adjuvants you use in a typical year',
      'any.required':
        'Select the quantity of PPPs or adjuvants you use in a typical year'
    })
})

const schema = Joi.object({
  businessActivities: Joi.array()
    .items(Joi.string().valid(...BUSINESS_ACTIVITIES))
    .min(1)
    .max(BUSINESS_ACTIVITIES.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one business activity',
      'any.required': 'Select at least one business activity'
    }),
  businessName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_BUSINESS_NAME)
    .required()
    .messages({
      'string.empty': 'Enter a business name',
      'string.max': 'Business name must be 200 characters or less',
      'any.required': 'Enter a business name'
    }),
  address: mainAddressSchema.required().messages({
    'any.required': 'Address is required'
  }),
  primaryContact: contactSchema.required().messages({
    'any.required': 'Primary contact details are required'
  }),
  usingPPPs: usingPPPsSchema.when('businessActivities', {
    is: includes(BUSINESS_ACTIVITY.USING),
    then: Joi.required(),
    otherwise: Joi.optional()
  })
})

// Explicit partial schema for PATCH /registrations/{reference}: every field
// is optional (a patch may touch only some of them), but unknown/dotted keys
// are rejected outright (unknown(false), the default) — a key such as
// "primaryContact.contactEmail" would otherwise write straight to Mongo and
// bypass the email-change revocation check below, which only inspects
// payload.primaryContact?.contactEmail on the *parsed* nested object.
// Shared by both populations for now (see README §"External-user RBAC" open
// question: whether case officers and external users should eventually have
// different editable-field sets).
const patchSchema = Joi.object({
  version: Joi.number().integer().min(0).strict().required().messages({
    'any.required': 'expectedVersion (version) is required'
  }),
  businessActivities: schema.extract('businessActivities').optional(),
  businessName: schema.extract('businessName').optional(),
  address: schema.extract('address').optional(),
  primaryContact: schema.extract('primaryContact').optional(),
  usingPPPs: usingPPPsSchema.optional()
})
  .min(2) // version + at least one real change
  .messages({ 'object.min': 'At least one field must be changed' })

// A PATCH only carries the fields being changed, so validating just those
// would lose the rules that link fields to each other (e.g. usingPPPs is
// required when using PPPs is ticked). Merge the changes into the stored
// record and check the result against the same full schema POST /register
// uses, so a record saved via PATCH is always one POST would have accepted.
const REGISTRATION_FIELDS = Object.keys(schema.describe().keys)

function assertMergedRegistrationIsValid(current, changes) {
  const stored = Object.fromEntries(
    REGISTRATION_FIELDS.filter((field) => field in current).map((field) => [
      field,
      current[field]
    ])
  )
  const { error } = schema.validate({ ...stored, ...changes })
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
        payload: schema.required(),
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
        payload: patchSchema,
        failAction: failWithBadRequest
      }
    },
    handler: async (request, h) => {
      const { reference } = request.params
      await authorise(request, { action: 'registration:update', reference })

      const { identityType, subject } = request.auth.credentials
      const { version, ...changes } = request.payload

      // Confirmed decision (completion ticket AC6): changing the contact
      // email must not carry over the old email's entitlement. Every
      // existing grant on this registration (for every identity, not just
      // the caller's) is revoked in the same transaction as the update; the
      // new email must re-verify — via the normal
      // POST /email-verifications(/verify) flow with this reference —
      // before anyone can access the registration again. Revocation only
      // happens when the stored email actually changes (compared normalised),
      // so editing the contact's name or phone number doesn't lock the
      // applicant out. Dotted keys are rejected by patchSchema, so this can
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
