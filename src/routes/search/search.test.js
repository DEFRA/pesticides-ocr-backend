describe('#searchRoute', () => {
  let server

  const record = {
    reference: 'PPP-A1B-2C3',
    name: 'fred',
    age: 30
  }

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()

    await server.db.collection('ocr-registration').insertOne({ ...record })
  })

  afterAll(async () => {
    await server.stop()
  })

  test('Should return the record for a known reference number', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-A1B-2C3'
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(record)
  })

  test('Should not expose the mongo _id', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-A1B-2C3'
    })

    expect(result).not.toHaveProperty('_id')
  })

  test('Should return 404 for a well formed reference that does not exist', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-ZZZ-999'
    })

    expect(statusCode).toBe(404)
    expect(result.message).toBe(
      'No records found for the reference number provided'
    )
  })

  test('Should return 400 for a malformed reference number', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search?reference=not-a-reference'
    })

    expect(statusCode).toBe(400)
    expect(result.message).toBe('Invalid reference number')
  })

  test('Should return 400 for a lower case reference number', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/search?reference=ppp-a1b-2c3'
    })

    expect(statusCode).toBe(400)
  })

  test('Should return 400 when the reference query parameter is missing', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search'
    })

    expect(statusCode).toBe(400)
    expect(result.message).toBe('Invalid reference number')
  })

  test('Should return 400 when the reference query parameter is empty', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/search?reference='
    })

    expect(statusCode).toBe(400)
  })

  test('Should return 400 when the reference query parameter is repeated', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-A1B-2C3&reference=PPP-ZZZ-999'
    })

    expect(statusCode).toBe(400)
  })

  test('Should ignore unknown query parameters', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-A1B-2C3&unexpected=value'
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(record)
  })

  test('Should not query mongo for a malformed reference number', async () => {
    const collection = vi.spyOn(server.db, 'collection')

    await server.inject({
      method: 'GET',
      url: '/search?reference=not-a-reference'
    })

    expect(collection).not.toHaveBeenCalled()

    // Prove the spy would have caught a query had one been made
    await server.inject({
      method: 'GET',
      url: '/search?reference=PPP-A1B-2C3'
    })

    expect(collection).toHaveBeenCalledWith('ocr-registration')

    collection.mockRestore()
  })
})
