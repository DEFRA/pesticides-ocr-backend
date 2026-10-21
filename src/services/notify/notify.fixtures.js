export const successfulSendEmailMock = {
  status: 201
}

// The shape notifications-node-client rejects with when Notify refuses a send:
// an axios error whose response body lists the problems. Its config carries
// the request body, including the email address and personalisation.
export const notifyRejectionMock = () =>
  Object.assign(new Error('Request failed with status code 400'), {
    code: 'ERR_BAD_REQUEST',
    config: {
      data: JSON.stringify({
        email_address: 'a.b@defra.gov.uk',
        personalisation: { submissionId: '1234567890' }
      })
    },
    response: {
      status: 400,
      data: {
        status_code: 400,
        errors: [
          {
            error: 'BadRequestError',
            message: 'Can’t send to this recipient using a team-only API key'
          }
        ]
      }
    }
  })

// A network failure or timeout has no response at all.
export const networkErrorMock = () => new Error('ECONNREFUSED')

export const emailArgs = ({
  templateName = 'submissionConfirmation',
  emailAddress = 'a.b@defra.gov.uk',
  personalisation = { submissionId: '1234567890' }
} = {}) => [templateName, emailAddress, personalisation]
