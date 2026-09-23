import Joi from 'joi'
import Boom from '@hapi/boom'

// The query contract shared by GET /search and GET /export (EQ-366). Both ask
// the same question — which registrations? — and differ only in what they do
// with the answer, so they validate identically rather than drifting apart.

// Both parameters are length-bounded so a caller can't push an oversized string
// into the query. A reference is a fixed 11-character format, so 32 is already
// generous; this keeps the bound the deleted /operators/{reference} route used
// rather than widening it. (#14 uses 100 on the same field — worth settling on
// one when that merges.)
export const MAX_SEARCH_LENGTH = 100
export const MAX_REFERENCE_LENGTH = 32

// Validation failures surface as a clean 400 rather than the raw Joi error.
export const failWithBadRequest = (_request, _h, err) => {
  throw Boom.badRequest(err.message)
}

// `xor` = exactly one of the two. So:
//   ?reference=PPP-A1B-2C3  exact lookup
//   ?q=Norfolk              free-text match
//   ?q=                     free-text match on a blank term, i.e. everything
// Supplying both is rejected, because there would be no sensible precedence.
// Supplying neither is rejected too, so "everything" (and, on /export, the
// whole register) is always an explicit ask rather than a bare request.
export const searchQuerySchema = Joi.object({
  reference: Joi.string().trim().max(MAX_REFERENCE_LENGTH),
  q: Joi.string().trim().max(MAX_SEARCH_LENGTH).allow('')
}).xor('reference', 'q')
