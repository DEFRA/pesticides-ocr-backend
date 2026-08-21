import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockCollection, mockDb, mockClient } = vi.hoisted(() => {
  const mockCollection = { deleteMany: vi.fn() }
  const mockDb = { collection: vi.fn().mockReturnValue(mockCollection) }
  const mockClient = {
    connect: vi.fn(),
    db: vi.fn().mockReturnValue(mockDb),
    close: vi.fn()
  }
  return { mockCollection, mockDb, mockClient }
})

vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function () {
    return mockClient
  })
}))

const { deleteSeed, SEED_PREFIX } = await import('./delete-seed.js')

describe('deleteSeed', () => {
  beforeEach(() => {
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 })
    mockClient.connect.mockResolvedValue(undefined)
    mockClient.close.mockResolvedValue(undefined)
  })

  test('deletes records matching the SED- prefix regex', async () => {
    await deleteSeed('mongodb://test', 'test-db')

    expect(mockCollection.deleteMany).toHaveBeenCalledWith({
      reference: { $regex: '^SED-' }
    })
  })

  test('logs the number of deleted records', async () => {
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 4 })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await deleteSeed('mongodb://test', 'test-db')

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('4'))
    vi.restoreAllMocks()
  })

  test('logs zero when no seeded records exist', async () => {
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await deleteSeed('mongodb://test', 'test-db')

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('0'))
    vi.restoreAllMocks()
  })

  test('closes the client on success', async () => {
    await deleteSeed('mongodb://test', 'test-db')
    expect(mockClient.close).toHaveBeenCalled()
  })

  test('closes the client even when an error is thrown', async () => {
    mockCollection.deleteMany.mockRejectedValue(new Error('db error'))

    await expect(deleteSeed('mongodb://test', 'test-db')).rejects.toThrow(
      'db error'
    )
    expect(mockClient.close).toHaveBeenCalled()
  })

  test('uses the correct collection name', async () => {
    await deleteSeed('mongodb://test', 'test-db')
    expect(mockDb.collection).toHaveBeenCalledWith('ocr-registration')
  })
})

describe('constants', () => {
  test('SEED_PREFIX is SED-', () => {
    expect(SEED_PREFIX).toBe('SED-')
  })
})

describe('CLI guard', () => {
  let originalArgv

  beforeEach(() => {
    originalArgv = [...process.argv]
    mockClient.connect.mockResolvedValue(undefined)
    mockClient.close.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.resetModules()
    vi.restoreAllMocks()
  })

  test('runs deleteSeed when invoked as the main module', async () => {
    vi.resetModules()
    const { fileURLToPath } = await import('url')
    process.argv = [
      process.argv[0],
      fileURLToPath(new URL('./delete-seed.js', import.meta.url))
    ]
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await import('./delete-seed.js')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockCollection.deleteMany).toHaveBeenCalled()
  })

  test('calls process.exit(1) and logs error when deleteSeed throws', async () => {
    vi.resetModules()
    const { fileURLToPath } = await import('url')
    process.argv = [
      process.argv[0],
      fileURLToPath(new URL('./delete-seed.js', import.meta.url))
    ]
    mockCollection.deleteMany.mockRejectedValue(new Error('db error'))
    vi.spyOn(process, 'exit').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await import('./delete-seed.js')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[delete-seed] Failed:'),
      'db error'
    )
  })
})
