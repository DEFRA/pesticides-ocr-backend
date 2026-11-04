import Joi from 'joi'
import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'
import { MAX_REQUEST_ID_LENGTH } from '#/common/constants/history.js'
import { config } from '#/config.js'
import { saveRegistration } from '#/services/registration/registration.js'
import { isEmailVerifiedForJourney } from '#/services/email-verification/registration-gate.js'
import { missingEmailVerificationSettings } from '#/services/email-verification/config-guard.js'
import { normalisedEmailSchema } from '#/services/email-verification/email-address.js'
import { requireJourneyId } from '#/common/helpers/require-journey-id.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { HTTP_CREATED } from '#/common/constants/http-status.js'
import { MAX_EMAIL_LENGTH } from '#/common/constants/email.js'
import {
  EMAIL_NOT_VERIFIED,
  SERVICE_NOT_CONFIGURED
} from '#/common/constants/error-codes.js'
import {
  ADDRESS_ACTIVITIES,
  ADDRESS_REGIONS,
  AGRI_SUBSECTORS,
  AMENITY_SUBSECTORS,
  BUSINESS_ACTIVITIES,
  BUSINESS_ACTIVITY,
  HORTI_SUBSECTORS,
  PROFESSIONAL_SECTORS,
  QUANTITY_BANDS,
  STORAGE_LOCATIONS,
  STORING_VALUES,
  WHO_APPLIES_VALUES
} from '#/common/constants/registration-answers.js'

const MAX_SHORT_TEXT = 100
const MAX_BUSINESS_NAME = 200
const MAX_TELEPHONE = 20
const MAX_MEMBER_SCHEMES = 50
const MAX_ADDITIONAL_ADDRESSES = 20

const ENTER_BUSINESS_NAME_MESSAGE = 'Enter a business name'

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
    .optional()
    .messages({
      'any.only': 'Select a country',
      'string.empty': 'Select a country',
      'any.required': 'Select a country'
    })
})

// Only the main business address asks for the country; additional addresses
// may send one but don't have to.
const mainAddressSchema = addressSchema.fork('addressRegion', (region) =>
  region.required()
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

const additionalAddressSchema = Joi.object({
  address: addressSchema.required().messages({
    'any.required': 'Address is required'
  }),
  contact: contactSchema.required().messages({
    'any.required': 'Contact details are required'
  }),
  activity: Joi.array()
    .items(Joi.string().valid(...ADDRESS_ACTIVITIES))
    .min(1)
    .max(ADDRESS_ACTIVITIES.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one activity',
      'any.required': 'Select at least one activity'
    })
})

// Either the ticked codes, or the applicant's own description under Other.
const codesOrOther = (codes, message) =>
  Joi.alternatives()
    .try(
      Joi.array()
        .items(Joi.string().valid(...codes))
        .max(codes.length)
        .unique(),
      Joi.array()
        .items(Joi.string().trim().min(1).max(MAX_SHORT_TEXT))
        .length(1)
    )
    .optional()
    .messages({
      'alternatives.match': message,
      'alternatives.types': message
    })

const oneOf = (values, message) =>
  Joi.string()
    .valid(...values)
    .optional()
    .messages({ 'any.only': message, 'string.empty': message })

// The "Using PPPs" section. Which answers are sent depends on the applicant's
// route through it, so every one is optional; any that are sent are validated.
const usingPPPsSchema = Joi.object({
  whoApplies: oneOf(
    WHO_APPLIES_VALUES,
    'Select who applies PPPs for your organisation'
  ),
  contractor: Joi.object({
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
    address: addressSchema.required().messages({
      'any.required': 'Contractor address is required'
    })
  }).optional(),
  professionalSectors: codesOrOther(
    PROFESSIONAL_SECTORS,
    'Select a sector or describe your main type of work'
  ),
  agriSubsectors: codesOrOther(
    AGRI_SUBSECTORS,
    'Select an agricultural sector or describe your main type of work'
  ),
  amenitySubsectors: codesOrOther(
    AMENITY_SUBSECTORS,
    'Select an amenity sector or describe your main type of work'
  ),
  hortiSubsectors: codesOrOther(
    HORTI_SUBSECTORS,
    'Select a horticultural sector or describe your main type of work'
  ),
  // The ticked schemes, the Other description, or none when skipped.
  memberSchemes: Joi.array()
    .items(Joi.string().trim().min(1).max(MAX_SHORT_TEXT))
    .max(MAX_MEMBER_SCHEMES)
    .unique()
    .optional(),
  storing: oneOf(STORING_VALUES, 'Select if you store the products you apply'),
  storageLocation: oneOf(
    STORAGE_LOCATIONS,
    'Select where you store the products you apply'
  ),
  ownStorageAddress: addressSchema.optional(),
  storageContact: contactSchema
    .keys({
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
    .optional(),
  quantity: oneOf(QUANTITY_BANDS, 'Select how much you use in a typical year')
})

const SELECT_ACTIVITIES_OR_ONLY_STORING =
  "Select either your activities or 'Only storing PPPs for other businesses'"

// "Only storing" is exclusive: it can't be sent alongside any other activity.
const onlyStoringOnItsOwn = (activities, helpers) =>
  activities.includes(BUSINESS_ACTIVITY.ONLY_STORING) && activities.length > 1
    ? helpers.error('array.exclusive')
    : activities

const schema = Joi.object({
  businessActivities: Joi.array()
    .items(Joi.string().valid(...BUSINESS_ACTIVITIES))
    .min(1)
    .max(BUSINESS_ACTIVITIES.length)
    .unique()
    .required()
    .custom(onlyStoringOnItsOwn)
    .messages({
      'array.min': 'Select at least one business activity',
      'any.required': 'Select at least one business activity',
      'array.exclusive': SELECT_ACTIVITIES_OR_ONLY_STORING
    }),
  businessName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_BUSINESS_NAME)
    .required()
    .messages({
      'string.empty': ENTER_BUSINESS_NAME_MESSAGE,
      'string.max': 'Business name must be 200 characters or less',
      'any.required': ENTER_BUSINESS_NAME_MESSAGE
    }),
  address: mainAddressSchema.required().messages({
    'any.required': 'Address is required'
  }),
  primaryContact: contactSchema.required().messages({
    'any.required': 'Primary contact details are required'
  }),
  // A business that uses PPPs answers the Using PPPs section instead.
  addressActivities: Joi.array()
    .items(Joi.string().valid(...ADDRESS_ACTIVITIES))
    .min(1)
    .max(ADDRESS_ACTIVITIES.length)
    .unique()
    .when('businessActivities', {
      is: Joi.array().has(BUSINESS_ACTIVITY.USING),
      then: Joi.optional(),
      otherwise: Joi.required()
    })
    .messages({
      'array.min': 'Select at least one address activity',
      'any.required': 'Select at least one address activity'
    }),
  usingPPPs: usingPPPsSchema.optional(),
  additionalAddresses: Joi.array()
    .items(additionalAddressSchema)
    .max(MAX_ADDITIONAL_ADDRESSES)
    .optional()
})

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
  }
]
