import Joi from 'joi'

import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'
import { validateReferenceNumber } from '#/services/search/search.js'

export const registrationParamsSchema = Joi.object({
  reference: Joi.string()
    .max(MAX_REFERENCE_LENGTH)
    .custom((reference, helpers) =>
      validateReferenceNumber(reference)
        ? reference
        : helpers.message('Invalid reference number')
    )
    .required()
})
