// Registration metrics for the case-officer performance dashboard (EQ-283).
//
// The database is the authoritative, consent-independent source for volume
// metrics — Google Analytics under-counts (it only sees users who accept
// analytics cookies), so the "number of registrants" figure and the DB side of
// completion rate / digital take-up come from here.

import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'

// Last hour/minute/second/millisecond of a day — the inclusive end-of-day bound.
const END_OF_DAY_HOURS = 23
const END_OF_DAY_MINUTES = 59
const END_OF_DAY_SECONDS = 59
const END_OF_DAY_MS = 999

// from/to are treated as inclusive calendar dates (UTC): the whole `from` day
// through the whole `to` day. So a bare date `to` (e.g. 2026-04-01) includes
// same-day submissions rather than cutting off at midnight.
const startOfDay = (date) => {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
const endOfDay = (date) => {
  const d = new Date(date)
  d.setUTCHours(
    END_OF_DAY_HOURS,
    END_OF_DAY_MINUTES,
    END_OF_DAY_SECONDS,
    END_OF_DAY_MS
  )
  return d
}

// Count registrations: a grand total plus a per-month time series (from
// `submittedAt`), optionally bounded by an inclusive from/to date range. One
// call gives the dashboard its month / year / life-of-service views.
export async function countRegistrations(db, { from, to } = {}) {
  const match = {}
  if (from || to) {
    match.submittedAt = {}
    if (from) {
      match.submittedAt.$gte = startOfDay(from)
    }
    if (to) {
      match.submittedAt.$lte = endOfDay(to)
    }
  }

  const pipeline = [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $facet: {
        total: [{ $count: 'count' }],
        byMonth: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m', date: '$submittedAt' } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]
      }
    }
  ]

  const [result] = await db
    .collection(OCR_REGISTRATION_COLLECTION)
    .aggregate(pipeline)
    .toArray()

  return {
    total: result.total[0]?.count ?? 0,
    byMonth: result.byMonth.map(({ _id, count }) => ({ month: _id, count }))
  }
}
