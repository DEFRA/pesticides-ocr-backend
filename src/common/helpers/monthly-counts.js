// A grand total plus a per-month series, counted the same way for every metric.

// Last hour/minute/second/millisecond of a day — the inclusive end-of-day bound.
const END_OF_DAY_HOURS = 23
const END_OF_DAY_MINUTES = 59
const END_OF_DAY_SECONDS = 59
const END_OF_DAY_MS = 999

// from/to are treated as inclusive calendar dates (UTC): the whole `from` day
// through the whole `to` day. So a bare date `to` (e.g. 2026-04-01) includes
// same-day events rather than cutting off at midnight.
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

export function monthlyCountsPipeline(options) {
  const { dateField, from, to } = options ?? {}
  if (typeof dateField !== 'string' || dateField === '') {
    throw new TypeError('dateField must be a non-empty string')
  }
  const match = {}
  if (from || to) {
    match[dateField] = {}
    if (from) {
      match[dateField].$gte = startOfDay(from)
    }
    if (to) {
      match[dateField].$lte = endOfDay(to)
    }
  }

  return [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $facet: {
        total: [{ $count: 'count' }],
        byMonth: [
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m', date: `$${dateField}` }
              },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]
      }
    }
  ]
}

export function toMonthlyCounts(result) {
  return {
    total: result.total[0]?.count ?? 0,
    byMonth: result.byMonth.map(({ _id, count }) => ({ month: _id, count }))
  }
}
