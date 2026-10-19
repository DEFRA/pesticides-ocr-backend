import {
  OCR_REGISTRATION_COLLECTION,
  OCR_REGISTRATION_HISTORY_COLLECTION
} from '#/common/constants/collections.js'
import { ACTOR_TYPE } from '#/common/constants/actors.js'
import {
  FIRST_VERSION,
  HISTORY_OPERATION,
  MAX_REQUEST_ID_LENGTH
} from '#/common/constants/history.js'
import { config } from '#/config.js'

const payload = {
  businessActivities: ['manufacture'],
  mainCustomer: 'professional',
  businessName: 'Company 1',
  address: {
    addressLine1: '67 My Road',
    addressTown: 'My Town',
    addressPostcode: 'AB12 3CD'
  },
  primaryContact: {
    contactName: 'Jonny Pesticide',
    contactTelephone: '01234567890',
    contactEmail: 'spray@everything.biz'
  },
  addressActivities: ['use'],
  quantity: { quantityType: 'area', quantity: '67' }
}

describe('POST /register through the audited repository', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('stores version 1 and its create history entry, made by an applicant', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/register',
      headers: { [config.get('tracing.header')]: 'request-123' },
      payload
    })
    const { reference } = JSON.parse(response.payload)

    const registration = await server.db
      .collection(OCR_REGISTRATION_COLLECTION)
      .findOne({ reference }, { projection: { _id: 0 } })
    expect(registration).toMatchObject({
      businessName: 'Company 1',
      isDeleted: false,
      version: FIRST_VERSION
    })

    const history = await server.db
      .collection(OCR_REGISTRATION_HISTORY_COLLECTION)
      .find({ reference }, { projection: { _id: 0 } })
      .toArray()
    expect(history).toEqual([
      expect.objectContaining({
        version: FIRST_VERSION,
        operation: HISTORY_OPERATION.CREATE,
        by: { type: ACTOR_TYPE.APPLICANT },
        requestId: 'request-123',
        snapshot: registration
      })
    ])
  })

  const historyFor = async (headers) => {
    const response = await server.inject({
      method: 'POST',
      url: '/register',
      headers,
      payload
    })
    expect(response.statusCode).toBe(201)
    const { reference } = JSON.parse(response.payload)
    return server.db
      .collection(OCR_REGISTRATION_HISTORY_COLLECTION)
      .findOne({ reference })
  }

  test('records no request ID when there is no header', async () => {
    expect(await historyFor({})).not.toHaveProperty('requestId')
  })

  test('keeps a request ID of the maximum length', async () => {
    const requestId = 'x'.repeat(MAX_REQUEST_ID_LENGTH)
    const entry = await historyFor({
      [config.get('tracing.header')]: requestId
    })

    expect(entry).toMatchObject({ requestId })
  })

  test.each([
    ['empty', ''],
    ['too long', 'x'.repeat(MAX_REQUEST_ID_LENGTH + 1)]
  ])(
    'still accepts the submission when the request ID header is %s',
    async (_label, value) => {
      const entry = await historyFor({ [config.get('tracing.header')]: value })

      expect(entry).not.toHaveProperty('requestId')
    }
  )
})
