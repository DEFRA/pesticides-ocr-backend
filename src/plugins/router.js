import { health } from '#/routes/health.js'
import { register } from '#/routes/registration.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health].concat(register))
    }
  }
}
