import { describe, test, expect } from 'vitest'

import { normaliseEmail } from '#/services/email-verification/email-address.js'

describe('#normaliseEmail', () => {
  test('trims and lower-cases the address', () => {
    expect(normaliseEmail('  Jane.Smith@Example.COM \t')).toBe(
      'jane.smith@example.com'
    )
  })

  test('keeps plus and dot variants apart', () => {
    expect(normaliseEmail('Jane.Smith+ocr@example.com')).toBe(
      'jane.smith+ocr@example.com'
    )
  })
})
