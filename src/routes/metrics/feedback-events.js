import {
  recordFeedbackStart,
  recordFeedbackReturn
} from '#/services/metrics/feedback/feedback.js'
import { beaconRoute } from './helpers/route-options.js'

export const metricsFeedbackEvents = [
  beaconRoute(
    '/metrics/feedback-starts',
    recordFeedbackStart,
    'feedback start'
  ),
  beaconRoute(
    '/metrics/feedback-returns',
    recordFeedbackReturn,
    'feedback return'
  )
]
