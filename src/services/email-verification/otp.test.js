import { describe, test, expect, vi } from 'vitest'

const { mockRandomInt } = vi.hoisted(() => ({ mockRandomInt: vi.fn() }))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, randomInt: mockRandomInt }
})

describe('generateCode', () => {
  test('pads a small random value with leading zeros to the requested length', async () => {
    mockRandomInt.mockReturnValue(5)
    const { generateCode } = await import('./otp.js')

    expect(generateCode(6)).toBe('000005')
    expect(generateCode(4)).toBe('0005')
  })

  test('requests a value within the digit range for the given length', async () => {
    mockRandomInt.mockReturnValue(0)
    const { generateCode } = await import('./otp.js')

    generateCode(4)
    expect(mockRandomInt).toHaveBeenCalledWith(0, 10000)

    generateCode(6)
    expect(mockRandomInt).toHaveBeenCalledWith(0, 1000000)
  })

  test('does not truncate a full-length value', async () => {
    mockRandomInt.mockReturnValue(482913)
    const { generateCode } = await import('./otp.js')

    expect(generateCode(6)).toBe('482913')
  })
})
