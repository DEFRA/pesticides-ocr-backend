import { summariseJourneys } from '#/services/metrics/journeys/index.js'
import { countRoute } from '../helpers/route-options.js'

// GET /metrics/journeys — the completion metric: starts, finishes, drop-outs and
// rates, overall, by year and by month (EQ-472, EQ-283). Case-officer protected.
export const metricsJourneys = [
  countRoute('/metrics/journeys', summariseJourneys)
]
