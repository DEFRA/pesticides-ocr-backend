// Shared time-arithmetic helpers, so the email-verification services (and
// anything else working in seconds against Date objects) use one definition
// instead of each redeclaring MS_PER_SECOND and addSeconds.
export const MS_PER_SECOND = 1000

export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * MS_PER_SECOND)
}
