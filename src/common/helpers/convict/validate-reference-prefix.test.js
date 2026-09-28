import { convictValidateReferencePrefix } from './validate-reference-prefix.js'

describe('#convictValidateReferencePrefix', () => {
  test.each(['PPP', 'OCR', 'SED', 'OCR2', 'P'.repeat(24)])(
    'With %s, Should not throw',
    (prefix) => {
      expect(() =>
        convictValidateReferencePrefix.validate(prefix)
      ).not.toThrow()
    }
  )

  test.each([
    ['lower case', 'ppp'],
    ['mixed case', 'Ppp'],
    ['a hyphen', 'P-P'],
    ['whitespace', 'PPP '],
    // 25 + '-XXX-XXX' = 33, one past the longest reference /search accepts
    ['a prefix too long for a searchable reference', 'P'.repeat(25)],
    ['an empty string', '']
  ])('With %s, Should throw', (_description, prefix) => {
    expect(() => convictValidateReferencePrefix.validate(prefix)).toThrow()
  })
})
