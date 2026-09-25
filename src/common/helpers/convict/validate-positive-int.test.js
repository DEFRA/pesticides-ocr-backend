import { convictValidatePositiveInt } from './validate-positive-int.js'

describe('#convictValidatePositiveInt', () => {
  test.each([1, 500, 10000])('With %s, Should not throw', (value) => {
    expect(() => convictValidatePositiveInt.validate(value)).not.toThrow()
  })

  test.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['a string', '10']
  ])('With %s, Should throw', (_description, value) => {
    expect(() => convictValidatePositiveInt.validate(value)).toThrow()
  })

  test.each([
    ['10000', 10000],
    ['1e4', 10000]
  ])('coerces the environment string %s to %s', (value, expected) => {
    expect(convictValidatePositiveInt.coerce(value)).toBe(expected)
  })

  // A string that isn't a whole number coerces to something validate rejects,
  // rather than being truncated into a plausible-looking limit.
  test.each(['abc', '10abc', '1.5', ''])(
    'rejects the environment string %j after coercion',
    (value) => {
      const coerced = convictValidatePositiveInt.coerce(value)
      expect(() => convictValidatePositiveInt.validate(coerced)).toThrow()
    }
  )
})
