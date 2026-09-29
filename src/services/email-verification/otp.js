import { randomInt } from 'node:crypto'

// Generates a fixed-length numeric code using a CSPRNG (never Math.random),
// left-padded with zeros so every code has exactly `length` digits.
export function generateCode(length) {
  const max = 10 ** length
  return String(randomInt(0, max)).padStart(length, '0')
}
