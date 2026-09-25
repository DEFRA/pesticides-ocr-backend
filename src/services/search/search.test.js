import {
  getOneByReferenceNumber,
  validateReferenceNumber
} from '#/services/search/search.js'
import { getOneByReferenceNumber as sharedLookup } from '#/common/helpers/ocr-search.js'

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

describe('#getOneByReferenceNumber', () => {
  test('is the shared ocr-registration lookup, re-exported for the /search route', () => {
    expect(getOneByReferenceNumber).toBe(sharedLookup)
  })
})
