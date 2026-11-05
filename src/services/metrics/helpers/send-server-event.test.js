import {
  fetch,
  MockAgent,
  getGlobalDispatcher,
  setGlobalDispatcher
} from 'undici'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sendServerEvent } from './send-server-event.js'

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal()),
  fetch: vi.fn()
}))

describe('sendServerEvent', () => {
  const recordedAt = new Date('2026-06-01T00:30:00Z')
  let warn
  let originalSettings

  beforeEach(() => {
    originalSettings = config.get('googleAnalytics')
    config.set('googleAnalytics.measurementId', 'G-SERVERTEST')
    config.set('googleAnalytics.apiSecret', 'private-test-secret')
    fetch.mockReset().mockResolvedValue({ ok: true, status: 204 })
    warn = vi.spyOn(createLogger(), 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    config.set('googleAnalytics', originalSettings)
    vi.restoreAllMocks()
  })

  test('sends only the event, recorded timestamp and fixed environment client ID', async () => {
    await sendServerEvent('server_journey_start', recordedAt)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url.origin + url.pathname).toBe(
      'https://www.google-analytics.com/mp/collect'
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      measurement_id: 'G-SERVERTEST',
      api_secret: 'private-test-secret'
    })
    expect(options).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        client_id: `server-metrics-${config.get('cdpEnvironment')}`,
        timestamp_micros: 1780273800000000,
        events: [{ name: 'server_journey_start' }]
      })
    })
    expect(warn).not.toHaveBeenCalled()
  })

  test('reuses the same client ID for different events', async () => {
    await sendServerEvent('server_journey_start', recordedAt)
    await sendServerEvent('server_registration_complete', recordedAt)

    const ids = fetch.mock.calls.map(
      ([, options]) => JSON.parse(options.body).client_id
    )
    expect(new Set(ids).size).toBe(1)
  })

  test('uses the configured Undici dispatcher with the real HTTP client', async () => {
    const undici = await vi.importActual('undici')
    const builtInFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Built-in fetch must not be used'))
    const previousDispatcher = getGlobalDispatcher()
    const dispatcher = new MockAgent()
    dispatcher.disableNetConnect()
    dispatcher
      .get('https://www.google-analytics.com')
      .intercept({
        path: '/mp/collect?measurement_id=G-SERVERTEST&api_secret=private-test-secret',
        method: 'POST',
        body: JSON.stringify({
          client_id: `server-metrics-${config.get('cdpEnvironment')}`,
          timestamp_micros: 1780273800000000,
          events: [{ name: 'server_journey_start' }]
        })
      })
      .reply(204)

    fetch.mockImplementation(undici.fetch)
    setGlobalDispatcher(dispatcher)
    try {
      await sendServerEvent('server_journey_start', recordedAt)

      dispatcher.assertNoPendingInterceptors()
      expect(builtInFetch).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      setGlobalDispatcher(previousDispatcher)
      await dispatcher.close()
    }
  })

  test.each([
    ['', ''],
    ['G-SERVERTEST', ''],
    ['', 'private-test-secret']
  ])(
    'does not send with measurement ID %s and secret %s',
    async (id, secret) => {
      config.set('googleAnalytics.measurementId', id)
      config.set('googleAnalytics.apiSecret', secret)

      await sendServerEvent('server_journey_start', recordedAt)

      expect(fetch).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    }
  )

  test('warns on a rejected response without logging its body or URL', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 503,
      body: 'private-test-secret'
    })

    await expect(
      sendServerEvent('server_journey_start', recordedAt)
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: 'server_journey_start', status: 503 },
      'GA server event delivery failed'
    )
  })

  test('contains transport errors without logging potentially sensitive details', async () => {
    fetch.mockRejectedValue(
      new Error('request failed: api_secret=private-test-secret applicant-data')
    )

    await expect(
      sendServerEvent('server_journey_start', recordedAt)
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: 'server_journey_start' },
      'GA server event delivery failed'
    )
  })

  test('aborts after two seconds and handles the timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    let signal
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        })
    )

    const delivery = sendServerEvent('server_journey_start', recordedAt)
    expect(timeout).toHaveBeenCalledWith(2000)
    expect(signal.aborted).toBe(false)
    await delivery

    expect(signal.aborted).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
