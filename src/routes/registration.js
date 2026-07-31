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

const mainCustomerValues = ['professional', 'amateur', 'both']

const addressActivitiesValues = ['use', 'store', 'records']

const schema = Joi.object({
  businessActivities: Joi.array()
    .items(Joi.string().valid(...businessActivitiesValues))
    .min(1)
    .required()
    .messages({
      'array.min': 'Select at least one business activity',
      'any.required': 'Select at least one business activity'
    }),
  mainCustomer: Joi.string()
    .valid(...mainCustomerValues)
    .required()
    .messages({
      'any.only': 'Select a customer type',
      'any.required': 'Select a customer type'
    }),
  businessName: Joi.string().trim().min(1).required().messages({
    'string.empty': 'Enter a business name',
    'any.required': 'Enter a business name'
  }),
  address: Joi.object({
    line1: Joi.string().trim().min(1).required().messages({
      'string.empty': "Enter the first line of your business's address",
      'any.required': "Enter the first line of your business's address"
    }),
    line2: Joi.string().trim().allow('').optional(),
    town: Joi.string().trim().min(1).required().messages({
      'string.empty': 'Enter town or city',
      'any.required': 'Enter town or city'
    }),
    county: Joi.string().trim().allow('').optional(),
    postcode: Joi.string().trim().min(1).required().messages({
      'string.empty': 'Enter your postcode',
      'any.required': 'Enter your postcode'
    })
  })
    .required()
    .messages({ 'any.required': 'Address is required' }),
  contact: Joi.object({
    name: Joi.string().trim().min(1).required().messages({
      'string.empty': 'Enter a contact name',
      'any.required': 'Enter a contact name'
    }),
    telephone: Joi.string()
      .trim()
      .pattern(/^[0-9+()\- ]+$/)
      .required()
      .messages({
        'string.empty': 'Enter a telephone number',
        'string.pattern.base': 'Enter a valid telephone number',
        'any.required': 'Enter a telephone number'
      }),
    email: Joi.string().email().required().messages({
      'string.empty': 'Enter an email address',
      'string.email': 'Enter a valid email address',
      'any.required': 'Enter an email address'
    })
  })
    .required()
    .messages({ 'any.required': 'Contact details are required' }),
  addressActivities: Joi.array()
    .items(Joi.string().valid(...addressActivitiesValues))
    .min(1)
    .required()
    .messages({
      'array.min': 'Select at least one address activity',
      'any.required': 'Select at least one address activity'
    }),
  quantity: Joi.number().positive().required().messages({
    'number.base': 'Enter a valid quantity',
    'number.positive': 'Enter a valid quantity',
    'any.required': 'Enter a quantity'
  })
})

export const register = [
  {
    method: 'POST',
    path: '/register',
    options: {
      validate: {
        payload: schema,
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
      const result = await saveRegistration(request.db, request.payload)
      return h.response({ reference: result.reference }).code(201)
    }
  }
]
