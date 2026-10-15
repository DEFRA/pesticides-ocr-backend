import {
  findRegistrations,
  findRegistrationsPage,
  getOneByReferenceNumber
} from '#/common/helpers/ocr-search.js'

describe('#getOneByReferenceNumber', () => {
  let findOne
  let collection
  let db

  beforeEach(() => {
    findOne = vi.fn()
    collection = vi.fn().mockReturnValue({ findOne })
    db = { collection }
  })

  test('Should query ocr-registration by reference, without the _id', async () => {
    const record = { reference: 'PPP-A1B-2C3', name: 'fred' }
    findOne.mockResolvedValue(record)

    const result = await getOneByReferenceNumber(db, 'PPP-A1B-2C3')

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(findOne).toHaveBeenCalledWith(
      { reference: 'PPP-A1B-2C3' },
      { projection: { _id: 0 } }
    )
    expect(result).toEqual(record)
  })

  test('Should return null when no record matches', async () => {
    findOne.mockResolvedValue(null)

    expect(await getOneByReferenceNumber(db, 'PPP-ZZZ-999')).toBeNull()
  })
})

describe('#findRegistrations', () => {
  let cursor
  let sort
  let find
  let collection
  let db

  beforeEach(() => {
    // Chainable Mongo cursor stub: find().sort().limit().toArray()
    cursor = { toArray: vi.fn().mockResolvedValue([]) }
    cursor.limit = vi.fn().mockReturnValue(cursor)
    sort = vi.fn().mockReturnValue(cursor)
    find = vi.fn().mockReturnValue({ sort })
    collection = vi.fn().mockReturnValue({ find })
    db = { collection }
  })

  test('queries ocr-registration with the given filter, sort and limit, without the _id', async () => {
    await findRegistrations(db, {
      filter: { reference: 'PPP-A1B-2C3' },
      sort: { submittedAt: -1 },
      limit: 5
    })

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(find).toHaveBeenCalledWith(
      { reference: 'PPP-A1B-2C3' },
      { projection: { _id: 0 } }
    )
    expect(sort).toHaveBeenCalledWith({ submittedAt: -1 })
    expect(cursor.limit).toHaveBeenCalledWith(5)
    expect(cursor.toArray).toHaveBeenCalled()
  })

  test('defaults to an unfiltered, unsorted, uncapped (limit 0) query', async () => {
    await findRegistrations(db)

    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 0 } })
    expect(sort).toHaveBeenCalledWith({})
    expect(cursor.limit).toHaveBeenCalledWith(0)
  })
})

describe('#findRegistrationsPage', () => {
  let cursor
  let find
  let countDocuments
  let collection
  let db

  beforeEach(() => {
    cursor = { toArray: vi.fn().mockResolvedValue([{ reference: 'PPP-A' }]) }
    cursor.sort = vi.fn().mockReturnValue(cursor)
    cursor.skip = vi.fn().mockReturnValue(cursor)
    cursor.limit = vi.fn().mockReturnValue(cursor)
    find = vi.fn().mockReturnValue(cursor)
    countDocuments = vi.fn().mockResolvedValue(42)
    collection = vi.fn().mockReturnValue({ find, countDocuments })
    db = { collection }
  })

  test('reads one page and counts every match of the same filter', async () => {
    const filter = { reference: /ABC/i }

    const result = await findRegistrationsPage(db, {
      filter,
      sort: { submittedAt: -1 },
      projection: { reference: 1 },
      skip: 20,
      limit: 10
    })

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(find).toHaveBeenCalledWith(filter, {
      projection: { reference: 1, _id: 0 }
    })
    expect(cursor.sort).toHaveBeenCalledWith({ submittedAt: -1 })
    expect(cursor.skip).toHaveBeenCalledWith(20)
    expect(cursor.limit).toHaveBeenCalledWith(10)
    expect(countDocuments).toHaveBeenCalledWith(filter)
    expect(result).toEqual({ records: [{ reference: 'PPP-A' }], total: 42 })
  })

  test('always leaves out the _id, even with no projection given', async () => {
    await findRegistrationsPage(db)

    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 0 } })
    expect(cursor.skip).toHaveBeenCalledWith(0)
  })
})
