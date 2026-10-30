import Joi from 'joi'
import Boom from '@hapi/boom'
import { config } from '#/config.js'
import { saveRegistration } from '#/services/registration/registration.js'
import { isEmailVerifiedForJourney } from '#/services/email-verification/registration-gate.js'
import { missingEmailVerificationSettings } from '#/services/email-verification/config-guard.js'
import { normalisedEmailSchema } from '#/services/email-verification/email-address.js'
import { requireJourneyId } from '#/common/helpers/require-journey-id.js'
import { requestIdFromTrace } from '#/common/helpers/request-id.js'
import { withErrorCode } from '#/common/helpers/error-code.js'
import { HTTP_CREATED } from '#/common/constants/http-status.js'
import { MAX_EMAIL_LENGTH } from '#/common/constants/email.js'
import {
  EMAIL_NOT_VERIFIED,
  SERVICE_NOT_CONFIGURED
} from '#/common/constants/error-codes.js'
import {
  ADDRESS_ACTIVITIES,
  ADDRESS_ACTIVITY,
  BUSINESS_ACTIVITIES,
  BUSINESS_ACTIVITY,
  PROFESSIONAL_SECTORS,
  QUANTITY_TYPES
} from '#/common/constants/registration-answers.js'

const MAX_SHORT_TEXT = 100
const MAX_BUSINESS_NAME = 200
const MAX_TELEPHONE = 20
const MAX_MEMBER_SCHEMES = 50
const MAX_ADDITIONAL_ADDRESSES = 20

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
    })
})

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

const SELECT_SECTOR_MESSAGE =
  'Select a professional sector or describe your main type of work'

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
  mainCustomer: Joi.string()
    .trim()
    .min(1)
    .when('businessActivities', {
      is: Joi.array().has(BUSINESS_ACTIVITY.SELLER_AMATEUR),
      then: Joi.optional(),
      otherwise: Joi.required()
    })
    .messages({
      'string.empty': 'Enter your main customer',
      'any.required': 'Enter your main customer'
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
  address: addressSchema.required().messages({
    'any.required': 'Address is required'
  }),
  primaryContact: contactSchema.required().messages({
    'any.required': 'Primary contact details are required'
  }),
  addressActivities: Joi.array()
    .items(Joi.string().valid(...ADDRESS_ACTIVITIES))
    .min(1)
    .max(ADDRESS_ACTIVITIES.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one address activity',
      'any.required': 'Select at least one address activity'
    }),
  quantity: Joi.object({
    quantityType: Joi.string()
      .valid(...QUANTITY_TYPES)
      .required()
      .messages({
        'any.only': 'Select a quantity type',
        'any.required': 'Select a quantity type'
      }),
    quantity: Joi.number().positive().required().messages({
      'number.base': 'Enter a valid quantity',
      'number.positive': 'Quantity must be a positive number',
      'any.required': 'Enter a quantity'
    })
  })
    .when('addressActivities', {
      is: Joi.array().has(ADDRESS_ACTIVITY.USE),
      then: Joi.required(),
      otherwise: Joi.optional()
    })
    .messages({ 'any.required': 'Quantity is required' }),
  // Either the ticked sectors, or the applicant's own description under Other.
  professionalSectors: Joi.alternatives()
    .try(
      Joi.array()
        .items(Joi.string().valid(...PROFESSIONAL_SECTORS))
        .max(PROFESSIONAL_SECTORS.length)
        .unique(),
      Joi.array()
        .items(Joi.string().trim().min(1).max(MAX_SHORT_TEXT))
        .length(1)
    )
    .optional()
    .messages({
      'alternatives.match': SELECT_SECTOR_MESSAGE,
      'alternatives.types': SELECT_SECTOR_MESSAGE
    }),
  memberSchemes: Joi.array()
    .items(Joi.string().trim().min(1).max(MAX_SHORT_TEXT))
    .max(MAX_MEMBER_SCHEMES)
    .unique()
    .optional(),
  additionalAddresses: Joi.array()
    .items(additionalAddressSchema)
    .max(MAX_ADDITIONAL_ADDRESSES)
    .optional()
})

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
