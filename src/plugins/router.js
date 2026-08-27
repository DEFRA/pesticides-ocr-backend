import { health } from '#/routes/health.js'
import { register } from '#/routes/registration.js'
import { whoami } from '#/routes/whoami.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health].concat(register).concat([whoami]))
    }
  }
}
