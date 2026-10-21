import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  successfulSendEmailMock,
  notifyRejectionMock,
  networkErrorMock,
  emailArgs
} from './notify.fixtures.js'

const { mockSendEmail, mockLogger, configValues } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  configValues: {
    notify: {
      keyMode: 'test',
      apiKey: 'TEST-KEY',
      templates: { submissionConfirmation: 'test-template-id' }
    }
  }
}))

vi.mock('notifications-node-client', () => {
  return {
    NotifyClient: vi.fn(function () {
      return { sendEmail: mockSendEmail }
    })
  }
})

vi.mock('#/config.js', () => ({
  config: { get: (key) => configValues[key] }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const [, EMAIL_ADDRESS, PERSONALISATION] = emailArgs()

// Everything the logger was given, as one string, to search for leaks.
const loggedText = () =>
  JSON.stringify(
    Object.values(mockLogger).flatMap((log) => log.mock.calls),
    (_key, value) => (value instanceof Error ? value.message : value)
  )

let sendEmail
let NotifySendError

beforeEach(async () => {
  vi.resetModules()
  configValues.notify.apiKey = 'TEST-KEY'
  configValues.notify.templates.submissionConfirmation = 'test-template-id'
  ;({ sendEmail, NotifySendError } =
    await import('#/services/notify/notify.js'))
})

describe('success', () => {
  test('resolves with the Notify response', async () => {
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)

    const response = await sendEmail(...emailArgs())

    expect(response.status).toBe(201)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'test-template-id',
      EMAIL_ADDRESS,
      { personalisation: PERSONALISATION }
    )
  })

  test('logs the template name but not the address or personalisation', async () => {
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)

    await sendEmail(...emailArgs())

    expect(mockLogger.info).toHaveBeenCalledWith(
      { templateName: 'submissionConfirmation' },
      'Notify email sent'
    )
    expect(loggedText()).not.toContain(EMAIL_ADDRESS)
    expect(loggedText()).not.toContain(PERSONALISATION.submissionId)
  })
})

describe('failure', () => {
  test('rejects with the status and errors when Notify refuses the email (400)', async () => {
    mockSendEmail.mockRejectedValue(notifyRejectionMock())

    const result = sendEmail(...emailArgs())

    await expect(result).rejects.toBeInstanceOf(NotifySendError)
    await expect(result).rejects.toMatchObject({
      status: 400,
      code: 'ERR_BAD_REQUEST',
      errors: [
        {
          error: 'BadRequestError',
          message: 'Can’t send to this recipient using a team-only API key'
        }
      ]
    })
  })

  test('rejects without a status or errors when Notify is unreachable', async () => {
    mockSendEmail.mockRejectedValue(networkErrorMock())

    const result = sendEmail(...emailArgs())

    await expect(result).rejects.toBeInstanceOf(NotifySendError)
    await expect(result).rejects.toMatchObject({
      status: undefined,
      errors: []
    })
  })

  test.each([
    ['a 400 rejection', notifyRejectionMock],
    ['a network error', networkErrorMock]
  ])(
    'logs %s without the address or personalisation',
    async (_label, failure) => {
      mockSendEmail.mockRejectedValue(failure())

      await expect(sendEmail(...emailArgs())).rejects.toThrow()

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ templateName: 'submissionConfirmation' }),
        'Notify email failed'
      )
      expect(loggedText()).not.toContain(EMAIL_ADDRESS)
      expect(loggedText()).not.toContain(PERSONALISATION.submissionId)
    }
  )

  test('does not carry the address or personalisation on the rejection', async () => {
    mockSendEmail.mockRejectedValue(notifyRejectionMock())

    const error = await sendEmail(...emailArgs()).catch((e) => e)

    const serialised = JSON.stringify({ ...error, message: error.message })
    expect(serialised).not.toContain(EMAIL_ADDRESS)
    expect(serialised).not.toContain(PERSONALISATION.submissionId)
    expect(error.cause).toBeUndefined()
  })

  test('Throw error for unknown template', async () => {
    const response = sendEmail(
      ...emailArgs({ templateName: 'unknownTemplate' })
    )

    await expect(response).rejects.toThrow("Unknown template 'unknownTemplate'")
  })

  test('Throw error when no API key is configured', async () => {
    configValues.notify.apiKey = null

    const response = sendEmail(...emailArgs())

    await expect(response).rejects.toThrow('No Notify API key configured')
  })

  test('Throw error when no template ID is configured', async () => {
    configValues.notify.templates.submissionConfirmation = null

    const response = sendEmail(...emailArgs())

    await expect(response).rejects.toThrow(
      "Unknown template 'submissionConfirmation'"
    )
  })
})
