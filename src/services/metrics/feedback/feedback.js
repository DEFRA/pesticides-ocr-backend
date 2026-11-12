import { countByMonth } from '#/services/metrics/helpers/count-by-month.js'
import { recordEvent } from '#/services/metrics/helpers/record-event.js'
import {
  FEEDBACK_STARTS,
  FEEDBACK_RETURNS
} from '#/services/metrics/helpers/journey-events.js'

export const recordFeedbackStart = (db, nonce) =>
  recordEvent(db, FEEDBACK_STARTS, nonce)

export const recordFeedbackReturn = (db, nonce) =>
  recordEvent(db, FEEDBACK_RETURNS, nonce)

export const countFeedbackStarts = ({ db }, { from, to } = {}) =>
  countByMonth(db, { ...FEEDBACK_STARTS, from, to })

export const countFeedbackReturns = ({ db }, { from, to } = {}) =>
  countByMonth(db, { ...FEEDBACK_RETURNS, from, to })
