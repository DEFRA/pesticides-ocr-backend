import Joi from 'joi'
import Boom from '@hapi/boom'
import { saveRegistration } from '#/services/registration.js'

const businessActivitiesValues = [
  'manufacture',
  'market',
  'seller-professional',
  'seller-amateur',
  'use-professional'
]

const addressActivitiesValues = ['use', 'store', 'records']

const professionalSectorsValues = [
  'agriculture-horticulture',
  'amenity',
  'forestry'
]

const quantityTypeValues = ['area', 'amount']

const addressSchema = Joi.object({
  line1: Joi.string().trim().min(1).max(100).required().messages({
    'string.empty': "Enter the first line of your business's address",
    'string.max': 'Address line 1 must be 100 characters or less',
    'any.required': "Enter the first line of your business's address"
  }),
  line2: Joi.string().trim().max(100).allow('').optional().messages({
    'string.max': 'Address line 2 must be 100 characters or less'
  }),
  town: Joi.string().trim().min(1).max(100).required().messages({
    'string.empty': 'Enter town or city',
    'string.max': 'Town or city must be 100 characters or less',
    'any.required': 'Enter town or city'
  }),
  county: Joi.string().trim().max(100).allow('').optional().messages({
    'string.max': 'County must be 100 characters or less'
  }),
  postcode: Joi.string()
    .trim()
    .pattern(/^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i)
    .required()
    .messages({
      'string.empty': 'Enter your postcode',
      'string.pattern.base': 'Enter a valid UK postcode',
      'any.required': 'Enter your postcode'
    })
})

const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required().messages({
    'string.empty': 'Enter a contact name',
    'string.max': 'Contact name must be 100 characters or less',
    'any.required': 'Enter a contact name'
  }),
  telephone: Joi.string()
    .trim()
    .pattern(/^[0-9+()\- ]+$/)
    .min(1)
    .max(20)
    .required()
    .messages({
      'string.empty': 'Enter a telephone number',
      'string.pattern.base': 'Enter a valid telephone number',
      'string.max': 'Telephone number must be 20 characters or less',
      'any.required': 'Enter a telephone number'
    }),
  email: Joi.string().email().max(254).required().messages({
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
    .items(Joi.string().valid(...addressActivitiesValues))
    .min(1)
    .max(addressActivitiesValues.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one activity',
      'any.required': 'Select at least one activity'
    })
})

const schema = Joi.object({
  businessActivities: Joi.array()
    .items(Joi.string().valid(...businessActivitiesValues))
    .min(1)
    .max(businessActivitiesValues.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one business activity',
      'any.required': 'Select at least one business activity'
    }),
  businessName: Joi.string().trim().min(1).max(200).required().messages({
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
    .items(Joi.string().valid(...addressActivitiesValues))
    .min(1)
    .max(addressActivitiesValues.length)
    .unique()
    .required()
    .messages({
      'array.min': 'Select at least one address activity',
      'any.required': 'Select at least one address activity'
    }),
  quantity: Joi.object({
    quantityType: Joi.string()
      .valid(...quantityTypeValues)
      .required()
      .messages({
        'any.only': 'Select a quantity type',
        'any.required': 'Select a quantity type'
      }),
    quantity: Joi.string()
      .pattern(/^\d+(\.\d+)?$/)
      .required()
      .messages({
        'string.empty': 'Enter a quantity',
        'string.pattern.base': 'Enter a valid quantity',
        'any.required': 'Enter a quantity'
      })
  })
    .required()
    .messages({ 'any.required': 'Quantity is required' }),
  professionalSectors: Joi.array()
    .items(Joi.string().valid(...professionalSectorsValues))
    .max(professionalSectorsValues.length)
    .unique()
    .optional(),
  memberSchemes: Joi.array()
    .items(Joi.string().trim().min(1).max(100))
    .max(50)
    .unique()
    .optional(),
  additionalAddresses: Joi.array()
    .items(additionalAddressSchema)
    .max(20)
    .optional()
})

export const register = [
  {
    method: 'POST',
    path: '/register',
    options: {
      validate: {
        payload: Joi.object({
          formSession: Joi.object().required()
        }).required(),
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
      const { error, value } = schema.validate(request.payload.formSession, {
        abortEarly: false
      })
      if (error) {
        throw Boom.badRequest(error.message, {
          validation: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message
          }))
        })
      }

      const result = await saveRegistration(request.db, value)
      return h.response({ reference: result.reference }).code(201)
    }
  }
]
