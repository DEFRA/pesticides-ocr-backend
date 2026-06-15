import { pino } from 'pino'

import { loggerOptions } from '#/plugins/logger-options.js'

const logger = pino(loggerOptions)

export function createLogger() {
  return logger
}
