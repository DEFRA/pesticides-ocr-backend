import Joi from 'joi'
import { normalisedEmailSchema } from '#/services/email-verification/email-address.js'
import { MAX_EMAIL_LENGTH } from '#/common/constants/email.js'
import { MAX_REASON_LENGTH } from '#/common/constants/history.js'
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

export const registrationSchema = Joi.object({
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
const editableFields = {
  businessActivities: registrationSchema
    .extract('businessActivities')
    .optional(),
  businessName: registrationSchema.extract('businessName').optional(),
  address: registrationSchema.extract('address').optional(),
  primaryContact: registrationSchema.extract('primaryContact').optional(),
  usingPPPs: usingPPPsSchema.optional()
}

// `reason` is recorded in the history entry; it isn't a change in itself, so
// at least one editable field is still required.
export const patchRegistrationSchema = Joi.object({
  version: Joi.number().integer().min(0).strict().required().messages({
    'any.required': 'expectedVersion (version) is required'
  }),
  reason: Joi.string().trim().max(MAX_REASON_LENGTH).allow('').optional(),
  ...editableFields
})
  .or(...Object.keys(editableFields))
  .messages({ 'object.missing': 'At least one field must be changed' })
