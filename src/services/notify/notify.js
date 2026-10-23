import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { NotifyClient } from 'notifications-node-client'

const notifyConfig = config.get('notify')
const logger = createLogger()

let client

function getClient() {
  if (!client) {
    if (!notifyConfig.apiKey) {
      throw new Error('No Notify API key configured')
    }

    client = new NotifyClient(notifyConfig.apiKey)
  }

  return client
}

// What sendEmail rejects with. It carries Notify's status and error list but
// not the client's error, whose request config holds the email address and
// personalisation and would end up in any log the caller writes.
export class NotifySendError extends Error {
  constructor({ templateName, status, code, errors }) {
    super(`Notify failed to send '${templateName}' email`)
    this.name = 'NotifySendError'
    this.status = status
    this.code = code
    this.errors = errors
  }
}

// A Notify rejection has response.data.errors, a list of { error, message }.
// A network error or timeout has no response at all.
function describeFailure(templateName, error) {
  const errors = Object.values(error.response?.data?.errors ?? {}).map(
    ({ error: type, message }) => ({ error: type, message })
  )
  return {
    templateName,
    status: error.response?.status,
    code: error.code,
    errors
  }
}

// Rejects when Notify refuses the email or can't be reached. The email address
// and personalisation are never logged: the personalisation can hold a magic
// link.
async function sendEmail(templateName, emailAddress, personalisation) {
  const templateId = notifyConfig.templates[templateName]

  if (!templateId) {
    throw new Error(`Unknown template '${templateName}'`)
  }

  const notify = getClient()

  try {
    const response = await notify.sendEmail(templateId, emailAddress, {
      personalisation
    })
    logger.info({ templateName }, 'Notify email sent')
    return response
  } catch (error) {
    const failure = describeFailure(templateName, error)
    logger.error(failure, 'Notify email failed')
    throw new NotifySendError(failure)
  }
}

export { sendEmail }
