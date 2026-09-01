import { describe, test, expect } from 'vitest'

import { requireRole } from './require-role.js'
import { STRATEGY_NAME } from './strategy-name.js'

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
