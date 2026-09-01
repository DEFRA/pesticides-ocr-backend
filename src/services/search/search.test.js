import {
  getOneByReferenceNumber,
  validateReferenceNumber
} from '#/services/search/search.js'

const { configValues } = vi.hoisted(() => ({
  configValues: {}
}))

vi.mock('#/config.js', () => ({
  config: { get: (key) => configValues[key] }
}))

describe('#validateReferenceNumber', () => {
  describe('Outside development', () => {
    beforeEach(() => {
      configValues.isDevelopment = false
    })

    test.each(['PPP-A1B-2C3', 'PPP-000-000', 'PPP-ZZZ-999'])(
      'Should accept %s',
      (referenceNumber) => {
        expect(validateReferenceNumber(referenceNumber)).toBe(true)
      }
    )

    test.each([
      ['the development prefix', 'SED-A1B-2C3'],
      ['lower case', 'ppp-a1b-2c3'],
      ['a short group', 'PPP-AB-2C3'],
      ['a long group', 'PPP-A1B2-2C3'],
      ['trailing characters', 'PPP-A1B-2C3X'],
      ['a missing group', 'PPP-A1B'],
      ['no separators', 'PPPA1B2C3'],
      ['an underscore', 'PPP-A1_-2C3'],
      ['a non-ascii character', 'PPP-A1B-2Ç3'],
      ['an empty string', ''],
      ['a leading path segment', '../PPP-A1B-2C3'],
      ['a trailing path segment', 'PPP-A1B-2C3/etc'],
      ['a trailing newline', 'PPP-A1B-2C3\n']
    ])('Should reject %s', (_description, referenceNumber) => {
      expect(validateReferenceNumber(referenceNumber)).toBe(false)
    })
  })

  describe('In development', () => {
    beforeEach(() => {
      configValues.isDevelopment = true
    })

    test('Should accept a SED reference', () => {
      expect(validateReferenceNumber('SED-A1B-2C3')).toBe(true)
    })

    test('Should reject a PPP reference', () => {
      expect(validateReferenceNumber('PPP-A1B-2C3')).toBe(false)
    })

    test('Should reject lower case', () => {
      expect(validateReferenceNumber('sed-a1b-2c3')).toBe(false)
    })
  })
})

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
