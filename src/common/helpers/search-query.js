import Joi from 'joi'
import Boom from '@hapi/boom'

import { MAX_REFERENCE_LENGTH } from '#/common/constants/reference.js'
import {
  searchFields,
  WILDCARD,
  collapseWildcards
} from '#/common/helpers/search-terms.js'

export const MAX_SEARCH_LENGTH = 100

// Route cache settings for both routes. They return registrations, and even
// their errors say something about the register, so every response, success or
// error, is no-store rather than Hapi's default no-cache, which still lets a
// shared cache keep it.
export const noStoreCache = { otherwise: 'no-store' }

// Validation failures surface as a clean 400 rather than the raw Joi error.
export const failWithBadRequest = (_request, _h, err) => {
  throw Boom.badRequest(err.message)
}

const DEFAULT_PAGE_SIZE = 10

const MAX_PAGE = 10000

// Each `*` becomes `.*`, and each one multiplies regex backtracking. A run of
// `*` matches the same as one, so it counts as one.
const MAX_WILDCARDS = 5

function validateWildcards(term, helpers) {
  const collapsedTerm = collapseWildcards(term)
  if (collapsedTerm === WILDCARD) {
    return helpers.message(
      `{{#label}} must contain at least one character other than ${WILDCARD}`
    )
  }
  if (collapsedTerm.split(WILDCARD).length - 1 > MAX_WILDCARDS) {
    return helpers.message(
      `{{#label}} must contain no more than ${MAX_WILDCARDS} ${WILDCARD} wildcards`
    )
  }
  return term
}

const criterion = Joi.string()
  .trim()
  .empty('')
  .max(MAX_SEARCH_LENGTH)
  .custom(validateWildcards)

const criteria = ['q', ...Object.keys(searchFields)]

export function searchQuerySchema(maxPageSize) {
  return Joi.object({
    ...Object.fromEntries(criteria.map((name) => [name, criterion])),
    page: Joi.number().integer().min(1).max(MAX_PAGE).default(1),
    pageSize: Joi.number()
      .integer()
      .min(1)
      .max(maxPageSize)
      .default(Math.min(DEFAULT_PAGE_SIZE, maxPageSize))
  })
    .or(...criteria)
    .messages({
      'object.missing': `At least one search criterion is required: ${criteria.join(', ')}`
    })
}

// `xor` = exactly one of the two. So:
//   ?reference=PPP-A1B-2C3  exact lookup
//   ?q=Norfolk              free-text match
//   ?q=                     free-text match on a blank term, i.e. everything
// Supplying both is rejected, because there would be no sensible precedence.
// Supplying neither is rejected too, so exporting the whole register is always
// an explicit ask rather than a bare request.
export const exportQuerySchema = Joi.object({
  reference: Joi.string().trim().max(MAX_REFERENCE_LENGTH),
  q: Joi.string().trim().max(MAX_SEARCH_LENGTH).allow('')
}).xor('reference', 'q')
