export const successfulSendEmailMock = {
  status: 201
}

export const failedSendEmailMock = {
  status: 400,
  response: {
    data: {
      errors: [
        {
          email: 'Invalid email address'
        }
      ]
    }
  }
}

export const emailArgs = ({
  templateName = 'submissionConfirmation',
  emailAddress = 'a.b@defra.gov.uk',
  personalisation = { submissionId: '1234567890' }
} = {}) => [templateName, emailAddress, personalisation]
