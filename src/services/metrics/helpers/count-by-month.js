// Shared aggregation for the EQ-472 volume metrics: a grand total plus a
// per-month time series. Used by every read controller so the series are
// computed identically and stay comparable.

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

// A grand total plus a per-month time series over `dateField`, optionally
// bounded by an inclusive from/to range.
export async function countByMonth(
  db,
  { collection, dateField, from, to } = {}
) {
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

  const pipeline = [
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

  const [result] = await db.collection(collection).aggregate(pipeline).toArray()

  return {
    total: result.total[0]?.count ?? 0,
    byMonth: result.byMonth.map(({ _id, count }) => ({ month: _id, count }))
  }
}
