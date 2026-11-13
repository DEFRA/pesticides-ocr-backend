import { countJourneyStarts } from '#/services/metrics/journey-starts/journey-starts.js'
import { countJourneyNotEligible } from '#/services/metrics/journey-not-eligible/journey-not-eligible.js'
import { countRegistrations } from '#/services/metrics/registrations/registrations.js'
import {
  countFeedbackStarts,
  countFeedbackReturns
} from '#/services/metrics/feedback/feedback.js'

const RATE_DECIMAL_PLACES = 4
const YEAR_LENGTH = 4

const rate = (count, starts) =>
  starts
    ? Number(Math.min(1, count / starts).toFixed(RATE_DECIMAL_PLACES))
    : null

// Finishes can outnumber starts (a journey crossing a period end, or a start
// that wasn't recorded), so drop-outs floor at zero and rates cap at 1.
function summarise({
  starts,
  registrations,
  notEligible,
  feedbackStarted,
  feedbackReturned
}) {
  const finished = registrations + notEligible
  return {
    starts,
    registrations,
    notEligible,
    feedbackStarted,
    feedbackReturned,
    finished,
    dropOuts: Math.max(0, starts - finished),
    completionRate: rate(finished, starts),
    registrationRate: rate(registrations, starts)
  }
}

const countFor = (series, month) =>
  series.byMonth.find((entry) => entry.month === month)?.count ?? 0

// Months arrive sorted, so the years do too.
function byYear(monthly) {
  const years = new Map()
  for (const {
    month,
    starts,
    registrations,
    notEligible,
    feedbackStarted,
    feedbackReturned
  } of monthly) {
    const year = month.slice(0, YEAR_LENGTH)
    const sums = years.get(year) ?? {
      starts: 0,
      registrations: 0,
      notEligible: 0,
      feedbackStarted: 0,
      feedbackReturned: 0
    }
    sums.starts += starts
    sums.registrations += registrations
    sums.notEligible += notEligible
    sums.feedbackStarted += feedbackStarted
    sums.feedbackReturned += feedbackReturned
    years.set(year, sums)
  }
  return [...years].map(([year, sums]) => ({ year, ...summarise(sums) }))
}

export async function summariseJourneys(sources, { from, to } = {}) {
  const [
    starts,
    registrations,
    notEligible,
    feedbackStarted,
    feedbackReturned
  ] = await Promise.all([
    countJourneyStarts(sources, { from, to }),
    countRegistrations(sources, { from, to }),
    countJourneyNotEligible(sources, { from, to }),
    countFeedbackStarts(sources, { from, to }),
    countFeedbackReturns(sources, { from, to })
  ])

  // A document without its date field counts in the totals but has no month.
  const months = [
    ...new Set(
      [
        starts,
        registrations,
        notEligible,
        feedbackStarted,
        feedbackReturned
      ].flatMap((series) => series.byMonth.map(({ month }) => month))
    )
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  const monthly = months.map((month) => ({
    month,
    starts: countFor(starts, month),
    registrations: countFor(registrations, month),
    notEligible: countFor(notEligible, month),
    feedbackStarted: countFor(feedbackStarted, month),
    feedbackReturned: countFor(feedbackReturned, month)
  }))

  return {
    ...summarise({
      starts: starts.total,
      registrations: registrations.total,
      notEligible: notEligible.total,
      feedbackStarted: feedbackStarted.total,
      feedbackReturned: feedbackReturned.total
    }),
    byYear: byYear(monthly),
    byMonth: monthly.map(({ month, ...counts }) => ({
      month,
      ...summarise(counts)
    }))
  }
}
