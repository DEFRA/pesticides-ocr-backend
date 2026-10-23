import { describe, test, expect, vi, afterEach } from 'vitest'

import { createLogger } from '#/common/helpers/logging/logger.js'
import {
  METRICS,
  countEmailVerification
} from '#/services/email-verification/metrics.js'

const { mockCounter } = vi.hoisted(() => ({ mockCounter: vi.fn() }))

vi.mock('@defra/cdp-metrics', () => ({
  Metrics: vi.fn(function () {
    return { counter: mockCounter }
  })
}))

describe('#countEmailVerification', () => {
  const logger = createLogger()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('counts one, with the dimensions given', async () => {
    countEmailVerification(METRICS.REJECTED, { outcome: 'TOKEN_EXPIRED' })

    await vi.waitFor(() =>
      expect(mockCounter).toHaveBeenCalledWith(METRICS.REJECTED, 1, {
        outcome: 'TOKEN_EXPIRED'
      })
    )
  })

  test('counts with no dimensions by default', async () => {
    countEmailVerification(METRICS.LINK_SENT)

    await vi.waitFor(() =>
      expect(mockCounter).toHaveBeenCalledWith(METRICS.LINK_SENT, 1, {})
    )
  })

  test.each([
    [
      'rejects',
      () => {
        mockCounter.mockRejectedValueOnce(new Error('flush failed'))
      }
    ],
    [
      'throws',
      () => {
        mockCounter.mockImplementationOnce(() => {
          throw new Error('flush failed')
        })
      }
    ]
  ])('logs a counter that %s instead of throwing', async (_label, fail) => {
    fail()
    vi.spyOn(logger, 'warn')

    expect(() => countEmailVerification(METRICS.VERIFIED)).not.toThrow()
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error), metric: METRICS.VERIFIED },
        'Could not record metric'
      )
    )
  })
})
