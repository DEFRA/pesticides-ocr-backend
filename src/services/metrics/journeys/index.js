import { countJourneyStarts } from '#/services/metrics/journey-starts/journey-starts.js'
import { countJourneyNotEligible } from '#/services/metrics/journey-not-eligible/journey-not-eligible.js'
import { countRegistrations } from '#/services/metrics/registrations/registrations.js'

// Controller for GET /metrics/journeys (EQ-472, EQ-283): the digital completion
// metric in one response, so every report derives it the same way. Counted from
// the database for every applicant, whether or not they accepted analytics
// cookies, so it covers the journeys Google Analytics can't see.
//
// A journey is finished when it reaches either end point: a saved registration
// or the "You do not need to use this service" page. The completion rate is
// finished ÷ started; the registration rate counts registrations alone.

const RATE_DECIMAL_PLACES = 4
const YEAR_LENGTH = 4

const rate = (count, starts) =>
  starts ? Number((count / starts).toFixed(RATE_DECIMAL_PLACES)) : null

// A journey can start in one period and finish in the next, so a single
// period's drop-outs can come out negative; they are floored at zero. Rates are
// null when there are no starts to divide by.
function summarise({ starts, registrations, notEligible }) {
  const finished = registrations + notEligible
  return {
    starts,
    registrations,
    notEligible,
    finished,
    dropOuts: Math.max(0, starts - finished),
    completionRate: rate(finished, starts),
    registrationRate: rate(registrations, starts)
  }
}

const countFor = (series, month) =>
  series.byMonth.find((entry) => entry.month === month)?.count ?? 0

// Each year's totals, summed from the monthly counts (months arrive sorted, so
// the years do too).
function byYear(monthly) {
  const years = new Map()
  for (const { month, starts, registrations, notEligible } of monthly) {
    const year = month.slice(0, YEAR_LENGTH)
    const sums = years.get(year) ?? {
      starts: 0,
      registrations: 0,
      notEligible: 0
    }
    sums.starts += starts
    sums.registrations += registrations
    sums.notEligible += notEligible
    years.set(year, sums)
  }
  return [...years].map(([year, sums]) => ({ year, ...summarise(sums) }))
}

export async function summariseJourneys(db, { from, to } = {}) {
  const [starts, registrations, notEligible] = await Promise.all([
    countJourneyStarts(db, { from, to }),
    countRegistrations(db, { from, to }),
    countJourneyNotEligible(db, { from, to })
  ])

  // A document without its date field has no month; it still counts in the
  // totals but can't be placed in a period.
  const months = [
    ...new Set(
      [starts, registrations, notEligible].flatMap((series) =>
        series.byMonth.map(({ month }) => month)
      )
    )
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  const monthly = months.map((month) => ({
    month,
    starts: countFor(starts, month),
    registrations: countFor(registrations, month),
    notEligible: countFor(notEligible, month)
  }))

  return {
    ...summarise({
      starts: starts.total,
      registrations: registrations.total,
      notEligible: notEligible.total
    }),
    byYear: byYear(monthly),
    byMonth: monthly.map(({ month, ...counts }) => ({
      month,
      ...summarise(counts)
    }))
  }
}
