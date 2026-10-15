import { SignJWT } from 'jose'

function mockToken(roles) {
  return new SignJWT({ name: 'Test Officer', roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('officer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('mock-not-verified'))
}

describe('#searchRoute page size cap', () => {
  let server
  let config
  let originalMaxPageSize

  beforeAll(async () => {
    ;({ config } = await import('#/config.js'))
    originalMaxPageSize = config.get('search.maxPageSize')
    config.set('search.maxPageSize', 5)

    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('search.maxPageSize', originalMaxPageSize)
    await server.stop()
  })

  test('applies SEARCH_MAX_PAGE_SIZE to the route', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search?q=ABC&pageSize=6',
      headers: {
        authorization: `Bearer ${await mockToken(['case_officer'])}`
      }
    })

    expect(statusCode).toBe(400)
    expect(result.message).toBe('"pageSize" must be less than or equal to 5')
  })
})
