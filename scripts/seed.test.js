import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockCollection, mockClient } = vi.hoisted(() => {
  const mockCollection = {
    dropIndex: vi.fn(),
    createIndex: vi.fn(),
    insertOne: vi.fn()
  }
  const mockDb = { collection: vi.fn().mockReturnValue(mockCollection) }
  const mockClient = {
    connect: vi.fn(),
    db: vi.fn().mockReturnValue(mockDb),
    close: vi.fn()
  }
  return { mockCollection, mockClient }
})

vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function () {
    return mockClient
  }),
  ServerApiVersion: { v1: '1' }
}))

const {
  pickRandom,
  pickSubset,
  buildRecord,
  seed,
  parseSeedArgs,
  SEED_PREFIX,
  DEFAULT_COUNT
} = await import('./seed.js')

describe('pickRandom', () => {
  test('returns an element from the array', () => {
    const arr = ['a', 'b', 'c']
    expect(arr).toContain(pickRandom(arr))
  })

  test('works with a single-element array', () => {
    expect(pickRandom(['only'])).toBe('only')
  })
})

describe('pickSubset', () => {
  test('returns a non-empty array', () => {
    expect(pickSubset(['a', 'b', 'c']).length).toBeGreaterThan(0)
  })

  test('all elements come from the source array', () => {
    const source = ['use', 'store', 'records']
    const subset = pickSubset(source)
    expect(subset.every((item) => source.includes(item))).toBe(true)
  })

  test('returns the only element for a single-element array', () => {
    expect(pickSubset(['solo'])).toEqual(['solo'])
  })
})

describe('buildRecord', () => {
  test('returns all required top-level fields', () => {
    const record = buildRecord()
    expect(record).toMatchObject({
      businessActivities: expect.any(Array),
      businessName: expect.stringMatching(/^Seed Company \d+$/),
      address: expect.any(Object),
      primaryContact: expect.any(Object),
      addressActivities: expect.any(Array),
      quantity: expect.any(Object)
    })
  })

  test('address contains required fields with valid postcode', () => {
    const { address } = buildRecord()
    expect(address.line1).toMatch(/^\d+ Seed Street$/)
    expect(address.town).toBeTruthy()
    expect(address.postcode).toMatch(/^[A-Z]{1,2}\d[\dA-Z]?\s?\d[A-Z]{2}$/i)
  })

  test('primaryContact contains name, telephone and email', () => {
    const { primaryContact } = buildRecord()
    expect(primaryContact.name).toBeTruthy()
    expect(primaryContact.telephone).toMatch(/^0\d+$/)
    expect(primaryContact.email).toMatch(/^seed\d+@example\.com$/)
  })

  test('quantity has a valid quantityType', () => {
    const { quantity } = buildRecord()
    expect(['area', 'amount']).toContain(quantity.quantityType)
    expect(Number(quantity.quantity)).toBeGreaterThan(0)
  })

  test('businessActivities contains only valid values', () => {
    const valid = [
      'manufacture',
      'market',
      'seller-professional',
      'seller-amateur',
      'use-professional'
    ]
    const { businessActivities } = buildRecord()
    expect(businessActivities.every((a) => valid.includes(a))).toBe(true)
  })

  test('optional additionalAddresses entry has correct shape when present', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const { additionalAddresses } = buildRecord()
    expect(additionalAddresses).toBeDefined()
    expect(additionalAddresses[0]).toMatchObject({
      address: expect.any(Object),
      contact: expect.any(Object),
      activity: expect.any(Array)
    })
    vi.restoreAllMocks()
  })

  test('optional fields are absent when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const record = buildRecord()
    expect(record.additionalAddresses).toBeUndefined()
    expect(record.professionalSectors).toBeUndefined()
    expect(record.memberSchemes).toBeUndefined()
    vi.restoreAllMocks()
  })
})

describe('seed', () => {
  beforeEach(() => {
    mockCollection.dropIndex.mockResolvedValue({})
    mockCollection.createIndex.mockResolvedValue({})
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'abc' })
    mockClient.connect.mockResolvedValue(undefined)
    mockClient.close.mockResolvedValue(undefined)
  })

  test('inserts the specified number of records', async () => {
    await seed(3, 'mongodb://test', 'test-db')
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(3)
  })

  test('each inserted record has a SED- reference and submittedAt', async () => {
    await seed(2, 'mongodb://test', 'test-db')
    for (const call of mockCollection.insertOne.mock.calls) {
      expect(call[0].reference).toMatch(/^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
      expect(call[0].submittedAt).toBeInstanceOf(Date)
    }
  })

  test('creates the reference unique index on startup', async () => {
    await seed(1, 'mongodb://test', 'test-db')
    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { reference: 1 },
      { unique: true }
    )
  })

  test('logs each inserted reference', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await seed(2, 'mongodb://test', 'test-db')
    expect(console.log).toHaveBeenCalledTimes(3) // 2 inserts + 1 done
    vi.restoreAllMocks()
  })

  test('logs done message on completion', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await seed(1, 'mongodb://test', 'test-db')
    const calls = console.log.mock.calls.map((c) => c[0])
    expect(calls.some((m) => m.includes('Done'))).toBe(true)
    vi.restoreAllMocks()
  })

  test('retries silently on reference field duplicate key error', async () => {
    mockCollection.insertOne
      .mockRejectedValueOnce({ code: 11000, keyPattern: { reference: 1 } })
      .mockResolvedValue({ insertedId: 'abc' })

    await seed(1, 'mongodb://test', 'test-db')

    expect(mockCollection.insertOne).toHaveBeenCalledTimes(2)
  })

  test('throws on duplicate key error for a non-reference field', async () => {
    mockCollection.insertOne.mockRejectedValue({
      code: 11000,
      keyPattern: { referenceNumber: 1 }
    })

    await expect(seed(1, 'mongodb://test', 'test-db')).rejects.toMatchObject({
      keyPattern: { referenceNumber: 1 }
    })
  })

  test('throws on non-duplicate MongoDB errors', async () => {
    mockCollection.insertOne.mockRejectedValue(new Error('network failure'))

    await expect(seed(1, 'mongodb://test', 'test-db')).rejects.toThrow(
      'network failure'
    )
  })

  test('closes the client even when an error is thrown', async () => {
    mockCollection.insertOne.mockRejectedValue(new Error('boom'))

    await expect(seed(1, 'mongodb://test', 'test-db')).rejects.toThrow()
    expect(mockClient.close).toHaveBeenCalled()
  })
})

describe('constants', () => {
  test('SEED_PREFIX is SED', () => {
    expect(SEED_PREFIX).toBe('SED')
  })

  test('DEFAULT_COUNT is 10', () => {
    expect(DEFAULT_COUNT).toBe(10)
  })
})

describe('parseSeedArgs', () => {
  test('returns DEFAULT_COUNT when no --count argument is present', () => {
    expect(parseSeedArgs(['node', 'seed.js'])).toBe(DEFAULT_COUNT)
  })

  test('parses a valid --count argument', () => {
    expect(parseSeedArgs(['node', 'seed.js', '--count=25'])).toBe(25)
  })

  test('returns NaN for a non-numeric --count value', () => {
    expect(parseSeedArgs(['node', 'seed.js', '--count=abc'])).toBeNaN()
  })

  test('returns NaN for --count=0', () => {
    expect(parseSeedArgs(['node', 'seed.js', '--count=0'])).toBe(0)
  })
})

describe('CLI guard', () => {
  let originalArgv

  beforeEach(() => {
    originalArgv = [...process.argv]
    mockCollection.dropIndex.mockResolvedValue({})
    mockCollection.createIndex.mockResolvedValue({})
    mockClient.connect.mockResolvedValue(undefined)
    mockClient.close.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.resetModules()
    vi.restoreAllMocks()
  })

  test('runs seed when invoked as the main module', async () => {
    vi.resetModules()
    const { fileURLToPath } = await import('url')
    process.argv = [
      process.argv[0],
      fileURLToPath(new URL('./seed.js', import.meta.url)),
      '--count=1'
    ]
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'abc' })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await import('./seed.js')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1)
  })

  test('calls process.exit(1) and logs error for invalid count', async () => {
    vi.resetModules()
    const { fileURLToPath } = await import('url')
    process.argv = [
      process.argv[0],
      fileURLToPath(new URL('./seed.js', import.meta.url)),
      '--count=abc'
    ]
    vi.spyOn(process, 'exit').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'abc' })

    await import('./seed.js')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--count must be a positive integer')
    )
  })

  test('calls process.exit(1) and logs error when seed throws', async () => {
    vi.resetModules()
    const { fileURLToPath } = await import('url')
    process.argv = [
      process.argv[0],
      fileURLToPath(new URL('./seed.js', import.meta.url)),
      '--count=1'
    ]
    mockCollection.insertOne.mockRejectedValue(new Error('connection lost'))
    vi.spyOn(process, 'exit').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await import('./seed.js')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[seed] Failed:'),
      'connection lost'
    )
  })
})
