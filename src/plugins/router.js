import { health } from '#/routes/health.js'
import { search } from '#/routes/search/search.js'
import { register } from '#/routes/registration/registration.js'
import { whoami } from '#/routes/whoami/whoami.js'
import { exportRegistrations } from '#/routes/export/export.js'
import { metricsRegistrations } from '#/routes/metrics/registrations.js'
import { metricsJourneyStarts } from '#/routes/metrics/journey-starts.js'
import { metricsJourneyStartEvents } from '#/routes/metrics/journey-start-events.js'
import { metricsJourneyNotEligible } from '#/routes/metrics/journey-not-eligible.js'
import { metricsJourneyNotEligibleEvents } from '#/routes/metrics/journey-not-eligible-events.js'
import { warnIfJourneyTokenUnset } from '#/routes/metrics/helpers/journey-token-guard.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      warnIfJourneyTokenUnset(server)
      server.route(
        [health]
          .concat(register)
          .concat(search)
          .concat([whoami])
          .concat(exportRegistrations)
          .concat(metricsRegistrations)
          .concat(metricsJourneyStarts)
          .concat(metricsJourneyStartEvents)
          .concat(metricsJourneyNotEligible)
          .concat(metricsJourneyNotEligibleEvents)
      )
    }
  }
}
