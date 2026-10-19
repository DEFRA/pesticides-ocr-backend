import {
  resolveQuery,
  validateReferenceNumber
} from '#/services/search/search.js'

const { configValues } = vi.hoisted(() => ({
  configValues: {}
}))

vi.mock('#/config.js', () => ({
  config: { get: (key) => configValues[key] }
}))

describe('#validateReferenceNumber', () => {
  beforeEach(() => {
    configValues.referencePrefix = 'PPP'
  })

  describe('With the default referencePrefix', () => {
    test.each(['PPP-A1B-2C3', 'PPP-000-000', 'PPP-ZZZ-999'])(
      'Should accept %s',
      (referenceNumber) => {
        expect(validateReferenceNumber(referenceNumber)).toBe(true)
      }
    )

    test.each([
      ['any other prefix', 'SED-A1B-2C3'],
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

  // Registrations are generated with referencePrefix, so the validator follows
  // it rather than a hard-coded prefix.
  describe('With a non-default referencePrefix', () => {
    beforeEach(() => {
      configValues.referencePrefix = 'OCR'
    })

    test('Should accept the configured prefix', () => {
      expect(validateReferenceNumber('OCR-A1B-2C3')).toBe(true)
    })

    test('Should reject the default prefix', () => {
      expect(validateReferenceNumber('PPP-A1B-2C3')).toBe(false)
    })

    test('Should accept a configured prefix containing a digit', () => {
      configValues.referencePrefix = 'OCR2'
      expect(validateReferenceNumber('OCR2-A1B-2C3')).toBe(true)
    })
  })
})

describe('#resolveQuery', () => {
  test('Should cap a free text query at the export row limit when no limit is given', async () => {
    configValues['export.maxRows'] = 25
    const registrations = { search: vi.fn().mockResolvedValue([]) }

    await resolveQuery(registrations, { q: 'Farm' })

    expect(registrations.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 25 })
    )
  })

  test('Should read a single reference through the repository', async () => {
    configValues.referencePrefix = 'PPP'
    const registrations = { findByReference: vi.fn().mockResolvedValue(null) }

    expect(
      await resolveQuery(registrations, { reference: 'PPP-A1B-2C3' })
    ).toEqual({
      single: null
    })
    expect(registrations.findByReference).toHaveBeenCalledWith('PPP-A1B-2C3')
  })
})
