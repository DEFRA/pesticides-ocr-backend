// Backend journey tracking for the digital completion metric (EQ-472).
//
// The database is the authoritative, consent-independent source for volume
// metrics — Google Analytics under-counts (it only sees users who accept
// analytics cookies), so all four EQ-472 numbers come from here:
//   1. starts        — this module (`ocr-journey-starts`)
//   2. completions   — registrations (`ocr-registration.submittedAt`)
//   3. not-eligible  — this module (`ocr-journey-not-eligible`), users who exit
//                      via the "You do not need to use this service" page
//   4. drop-outs     — derived: starts − (completions + not-eligible)

import { COLLECTION } from '#/services/search/search.js'

// Journey events recorded server-side, once per session, as the applicant moves
// through the journey — a consent-free basis for completion rate. No PII: just a
// timestamp. Completions (finishes) come from the registrations collection.
export const JOURNEY_STARTS_COLLECTION = 'ocr-journey-starts'
export const JOURNEY_NOT_ELIGIBLE_COLLECTION = 'ocr-journey-not-eligible'

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

// Count "not-eligible" finishes from `endedAt` — applicants who exited via the
// "You do not need to use this service" page (a valid journey completion).
export async function countJourneyNotEligible(db, { from, to } = {}) {
  return countByMonth(db, {
    collection: JOURNEY_NOT_ELIGIBLE_COLLECTION,
    dateField: 'endedAt',
    from,
    to
  })
}

// Append one timestamped journey event. Called by the (public) beacon routes.
// The frontend fires each once per session (yar flag), but the backend keeps no
// correlation id, so it cannot collapse repeats from retries or bots — treat the
// resulting counts as best-effort raw totals, not precise unique-visitor figures.
async function recordEvent(db, collection, dateField) {
  await db.collection(collection).insertOne({ [dateField]: new Date() })
}

export async function recordJourneyStart(db) {
  return recordEvent(db, JOURNEY_STARTS_COLLECTION, 'startedAt')
}

export async function recordJourneyNotEligible(db) {
  return recordEvent(db, JOURNEY_NOT_ELIGIBLE_COLLECTION, 'endedAt')
}
