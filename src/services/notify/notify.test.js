import { describe, test, expect, vi } from 'vitest'
import {
  successfulSendEmailMock,
  failedSendEmailMock,
  emailArgs
} from './notify.fixtures.js'

const { mockSendEmail, configValues } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  configValues: {
    notify: {
      keyMode: 'test',
      apiKey: 'TEST-KEY',
      templates: { submissionConfirmation: 'test-template-id' }
    },
    isProduction: true
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

describe('success', () => {
  let sendEmail

  beforeEach(async () => {
    vi.resetModules()
    configValues.notify.apiKey = 'TEST-KEY'
    configValues.notify.keyMode = 'test'
    configValues.isProduction = true
    ;({ sendEmail } = await import('#/services/notify/notify.js'))
  })

  test('Send email successfully', async () => {
    configValues.isProduction = false
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const response = await sendEmail(...emailArgs())

    expect(response.status).toBe(201)
    expect(console.log).toHaveBeenCalledOnce()
  })

  test('No console log in production', async () => {
    mockSendEmail.mockResolvedValue(successfulSendEmailMock)

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const response = await sendEmail(...emailArgs())

    expect(response.status).toBe(201)
    expect(console.log).not.toHaveBeenCalled()
  })
})

describe('failure', () => {
  let sendEmail

  beforeEach(async () => {
    vi.resetModules()
    configValues.notify.apiKey = 'TEST-KEY'
    configValues.notify.keyMode = 'test'
    configValues.isProduction = true
    ;({ sendEmail } = await import('#/services/notify/notify.js'))
  })

  test('Send email failure', async () => {
    configValues.isProduction = false
    mockSendEmail.mockRejectedValue(failedSendEmailMock)

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await sendEmail(...emailArgs())

    expect(response.status).toBe(400)
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  test('No console error in production', async () => {
    mockSendEmail.mockRejectedValue(failedSendEmailMock)

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await sendEmail(...emailArgs())

    expect(response.status).toBe(400)
    expect(console.error).not.toHaveBeenCalled()
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
