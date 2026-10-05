import { config } from '#/config.js'
import { NotifyClient } from 'notifications-node-client'

const notifyConfig = config.get('notify')

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

function logSendEmailError(error, { emailAddress, templateName, templateId }) {
  console.error(
    `Error sending email to ${emailAddress} using template '${templateName}' (ID: ${templateId}):`
  )

  const errors = error.response?.data?.errors
  if (!errors) {
    console.error('  ', error.message ?? error)
    return
  }

  for (const [key, value] of Object.entries(errors)) {
    console.error(`  ${key}:`, value)
  }
}

async function sendEmail(templateName, emailAddress, personalisation) {
  const templateId = notifyConfig.templates[templateName]

  if (!templateId) {
    throw new Error(`Unknown template '${templateName}'`)
  }

  try {
    const response = await getClient().sendEmail(templateId, emailAddress, {
      personalisation
    })

    if (!config.get('isProduction')) {
      console.log(
        `Email sent to ${emailAddress} using template '${templateName}' (ID: ${templateId}). Response:`,
        response
      )
    }
    return response
  } catch (error) {
    if (!config.get('isProduction')) {
      logSendEmailError(error, { emailAddress, templateName, templateId })
    }

    throw error
  }
}

export { sendEmail }
