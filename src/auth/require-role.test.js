import { describe, test, expect, afterEach } from 'vitest'

import { config } from '#/config.js'
import { requireRole, getCaseOfficerRoles } from './require-role.js'
import { STRATEGY_NAME } from './strategy-name.js'

describe('getCaseOfficerRoles', () => {
  const original = config.get('auth.entra.roleValues')
  afterEach(() => config.set('auth.entra.roleValues', original))

  test('returns the single configured role by default', () => {
    expect(getCaseOfficerRoles()).toEqual(['case_officer'])
  })

  test('splits and trims a comma-separated list', () => {
    config.set('auth.entra.roleValues', 'case_officer, admin ,viewer')
    expect(getCaseOfficerRoles()).toEqual(['case_officer', 'admin', 'viewer'])
  })
})

describe('requireRole', () => {
  test('returns the strategy + scope for the given roles', () => {
    expect(requireRole('case_officer')).toEqual({
      strategy: STRATEGY_NAME,
      scope: ['case_officer']
    })
  })

  test('accepts multiple role values', () => {
    expect(requireRole('case_officer', 'admin').scope).toEqual([
      'case_officer',
      'admin'
    ])
  })

  test('throws (fails loud) when no non-empty role value is given', () => {
    expect(() => requireRole()).toThrow(/at least one role value/)
    expect(() => requireRole('')).toThrow(/at least one role value/)
  })
})
