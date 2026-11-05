import { fetch } from 'undici'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()
const TIMEOUT_MS = 2000
const MICROSECONDS_PER_MILLISECOND = 1000

// Call without awaiting: analytics delivery must not hold up the saved journey.
export async function sendServerEvent(name, recordedAt) {
  try {
    const { measurementId, apiSecret } = config.get('googleAnalytics')
    if (!measurementId || !apiSecret) {
      return
    }

    const url = new URL('https://www.google-analytics.com/mp/collect')
    url.searchParams.set('measurement_id', measurementId)
    url.searchParams.set('api_secret', apiSecret)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        client_id: `server-metrics-${config.get('cdpEnvironment')}`,
        timestamp_micros: recordedAt.getTime() * MICROSECONDS_PER_MILLISECOND,
        events: [{ name }]
      })
    })
    if (!response.ok) {
      logger.warn(
        { event: name, status: response.status },
        'GA server event delivery failed'
      )
    }
  } catch {
    // Transport errors can contain the URL (including the API secret).
    logger.warn({ event: name }, 'GA server event delivery failed')
  }
}
