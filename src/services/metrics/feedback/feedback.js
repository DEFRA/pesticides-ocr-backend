import { countByMonth } from '#/services/metrics/helpers/count-by-month.js'
import { recordEvent } from '#/services/metrics/helpers/record-event.js'
import {
  FEEDBACK_STARTS,
  FEEDBACK_COMPLETIONS
} from '#/services/metrics/helpers/journey-events.js'

export const recordFeedbackStart = (db, nonce) =>
  recordEvent(db, FEEDBACK_STARTS, nonce)

export const recordFeedbackCompletion = (db, nonce) =>
  recordEvent(db, FEEDBACK_COMPLETIONS, nonce)

export const countFeedbackStarts = ({ db }, { from, to } = {}) =>
  countByMonth(db, { ...FEEDBACK_STARTS, from, to })

export const countFeedbackCompletions = ({ db }, { from, to } = {}) =>
  countByMonth(db, { ...FEEDBACK_COMPLETIONS, from, to })
