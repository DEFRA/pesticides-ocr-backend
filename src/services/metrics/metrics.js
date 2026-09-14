// Service-performance metrics for the case-officer dashboard (EQ-283).
//
// The database is the authoritative, consent-independent source for volume
// metrics — Google Analytics under-counts (it only sees users who accept
// analytics cookies), so the "number of registrants" figure and both sides of
// completion rate (starts vs finishes) come from here.

import { COLLECTION } from '#/services/search/search.js'

// Journey "starts" recorded server-side, once per session, at the first journey
// page — a consent-free denominator for completion rate. No PII: just a
// timestamp. Finishes come from the registrations collection (`submittedAt`).
export const JOURNEY_STARTS_COLLECTION = 'ocr-journey-starts'

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
  d.setUTCHours(23, 59, 59, 999)
  return d
}

// A grand total plus a per-month time series over `dateField`, optionally
// bounded by an inclusive from/to range. Shared by registrations (finishes) and
// journey starts so the two series are computed identically and stay comparable.
async function countByMonth(db, { collection, dateField, from, to } = {}) {
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

// Count registrations (finishes) from `submittedAt`. One call gives the
// dashboard its month / year / life-of-service views.
export async function countRegistrations(db, { from, to } = {}) {
  return countByMonth(db, {
    collection: COLLECTION,
    dateField: 'submittedAt',
    from,
    to
  })
}

// Count journey starts from `startedAt` — the completion-rate denominator.
export async function countJourneyStarts(db, { from, to } = {}) {
  return countByMonth(db, {
    collection: JOURNEY_STARTS_COLLECTION,
    dateField: 'startedAt',
    from,
    to
  })
}

// Record a single journey start. Called by the (public) beacon route when an
// applicant begins the journey. The frontend fires it once per session (yar
// flag), but the backend keeps no correlation id, so it cannot collapse repeats
// from retries or bots — treat the resulting count as a best-effort raw total,
// not a precise unique-visitor figure.
export async function recordJourneyStart(db) {
  await db
    .collection(JOURNEY_STARTS_COLLECTION)
    .insertOne({ startedAt: new Date() })
}
