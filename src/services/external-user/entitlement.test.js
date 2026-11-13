import { isEntitledToRegistration } from './entitlement.js'

describe('isEntitledToRegistration', () => {
  test('true when the verified email matches the registration contact email exactly', () => {
    const registration = {
      primaryContact: { contactEmail: 'applicant@example.com' }
    }
    expect(
      isEntitledToRegistration(registration, 'applicant@example.com')
    ).toBe(true)
  })

  test('true when the emails differ only by case/whitespace', () => {
    const registration = {
      primaryContact: { contactEmail: 'Applicant@Example.com' }
    }
    expect(
      isEntitledToRegistration(registration, '  applicant@example.com  ')
    ).toBe(true)
  })

  test('false when the verified email belongs to a different registration', () => {
    const registration = {
      primaryContact: { contactEmail: 'owner@example.com' }
    }
    expect(isEntitledToRegistration(registration, 'intruder@example.com')).toBe(
      false
    )
  })

  test('false when the registration is null/undefined (no disclosure of existence)', () => {
    expect(isEntitledToRegistration(null, 'applicant@example.com')).toBe(false)
    expect(isEntitledToRegistration(undefined, 'applicant@example.com')).toBe(
      false
    )
  })

  test('false when the registration has no primary contact email', () => {
    expect(isEntitledToRegistration({}, 'applicant@example.com')).toBe(false)
  })
})
