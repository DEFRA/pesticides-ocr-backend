import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { auditEmailVerification } from '#/services/email-verification/audit.js'
import { hashEmail } from '#/services/email-verification/email-hash.js'

const { mockAudit } = vi.hoisted(() => ({ mockAudit: vi.fn() }))

vi.mock('@defra/cdp-auditing', () => ({ audit: mockAudit }))

const SECRET = 'hash-test-secret'
const EMAIL = 'jane.smith@example.com'
const JOURNEY = 'journey-1'

describe('#auditEmailVerification', () => {
  let originalSecret
  const logger = createLogger()

  beforeEach(() => {
    originalSecret = config.get('emailVerification.hashSecret')
    config.set('emailVerification.hashSecret', SECRET)
  })

  afterEach(() => {
    config.set('emailVerification.hashSecret', originalSecret)
    vi.restoreAllMocks()
  })

  test('writes the event, journey id, email hash and details', () => {
    auditEmailVerification('SOME_EVENT', {
      journeyId: JOURNEY,
      email: EMAIL,
      limit: 'email'
    })

    expect(mockAudit).toHaveBeenCalledWith(
      {
        event: 'SOME_EVENT',
        journeyId: JOURNEY,
        emailHash: hashEmail(EMAIL, SECRET),
        limit: 'email'
      },
      'SOME_EVENT'
    )
  })

  test('never writes the address', () => {
    auditEmailVerification('SOME_EVENT', { journeyId: JOURNEY, email: EMAIL })

    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('jane.smith')
  })

  test('leaves out the journey id and hash when there are none', () => {
    auditEmailVerification('SOME_EVENT', { journeyId: null, code: 'X' })

    expect(mockAudit).toHaveBeenCalledWith(
      { event: 'SOME_EVENT', code: 'X' },
      'SOME_EVENT'
    )
  })

  test('leaves out the hash when the hash secret is not configured', () => {
    config.set('emailVerification.hashSecret', '')

    auditEmailVerification('SOME_EVENT', { journeyId: JOURNEY, email: EMAIL })

    expect(mockAudit.mock.calls[0][0]).not.toHaveProperty('emailHash')
  })

  test('does not let details overwrite the event or journey id', () => {
    auditEmailVerification('SOME_EVENT', {
      journeyId: JOURNEY,
      event: 'OTHER'
    })

    expect(mockAudit.mock.calls[0][0]).toEqual({
      event: 'SOME_EVENT',
      journeyId: JOURNEY
    })
  })

  test('logs a failed write instead of throwing', () => {
    const failure = new Error('stdout closed')
    mockAudit.mockImplementationOnce(() => {
      throw failure
    })
    vi.spyOn(logger, 'error')

    expect(() =>
      auditEmailVerification('SOME_EVENT', { journeyId: JOURNEY, email: EMAIL })
    ).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, event: 'SOME_EVENT' },
      'Could not write audit event'
    )
  })
})
