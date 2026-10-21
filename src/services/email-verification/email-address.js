import Joi from 'joi'

// How an address is stored and compared: trimmed and lower-cased. The request
// endpoint builds its payload rule on this, and the /register gate normalises
// the contact email with it, so the two always agree.
export const normalisedEmailSchema = Joi.string().trim().lowercase()

export function normaliseEmail(email) {
  return normalisedEmailSchema.validate(email).value
}
