import { summariseJourneys } from '#/services/metrics/journeys/index.js'
import { countRoute } from '../helpers/route-options.js'

export const metricsJourneys = [
  countRoute('/metrics/journeys', summariseJourneys)
]
