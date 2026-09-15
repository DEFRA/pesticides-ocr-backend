import { health } from '#/routes/health.js'
import { search } from '#/routes/search/search.js'
import { register } from '#/routes/registration.js'
import { whoami } from '#/routes/whoami.js'
import { operators } from '#/routes/operators/operators.js'
import { metrics, warnIfJourneyTokenUnset } from '#/routes/metrics/metrics.js'

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
          .concat(operators)
          .concat(metrics)
      )
    }
  }
}
