import { countByMonth } from './count-by-month.js'
import {
  JOURNEY_STARTS_COLLECTION,
  JOURNEY_NOT_ELIGIBLE_COLLECTION,
  OCR_REGISTRATION_COLLECTION
} from '#/common/constants/collections.js'
import { SUBMITTED_AT } from '#/common/constants/registration.js'

describe('#countByMonth', () => {
  let facet
  let aggregate
  let collection
  let db

  // Capture the pipeline the helper builds, and let each test choose what the
  // $facet stage returns.
  function stubDb(result) {
    facet = result
    aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([facet])
    })
    collection = vi.fn().mockReturnValue({ aggregate })
    db = { collection }
  }

  // The $match stage is optional, so read it back by shape rather than index.
  const matchStage = () =>
    aggregate.mock.calls[0][0].find((stage) => stage.$match)?.$match

  beforeEach(() => {
    stubDb({ total: [{ count: 2 }], byMonth: [] })
  })

  test('aggregates the requested collection', async () => {
    await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt'
    })

    expect(collection).toHaveBeenCalledWith(JOURNEY_STARTS_COLLECTION)
  })

  test('omits the $match stage entirely when neither bound is given', async () => {
    await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt'
    })

    expect(matchStage()).toBeUndefined()
  })

  test('groups by year-month over the given date field', async () => {
    await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt'
    })

    const { byMonth } = aggregate.mock.calls[0][0].at(-1).$facet
    expect(byMonth[0].$group._id).toEqual({
      $dateToString: { format: '%Y-%m', date: '$startedAt' }
    })
    expect(byMonth[1]).toEqual({ $sort: { _id: 1 } })
  })

  test('bounds `from` at the very start of that UTC day', async () => {
    await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt',
      from: '2026-03-11'
    })

    expect(matchStage()).toEqual({
      startedAt: { $gte: new Date('2026-03-11T00:00:00.000Z') }
    })
  })

  test('bounds `to` at the very end of that UTC day, so same-day events count', async () => {
    await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt',
      to: '2026-04-01'
    })

    expect(matchStage()).toEqual({
      startedAt: { $lte: new Date('2026-04-01T23:59:59.999Z') }
    })
  })

  test('applies both bounds inclusively over the same field', async () => {
    await countByMonth(db, {
      collection: JOURNEY_NOT_ELIGIBLE_COLLECTION,
      dateField: 'endedAt',
      from: '2026-03-11',
      to: '2026-04-01'
    })

    expect(matchStage()).toEqual({
      endedAt: {
        $gte: new Date('2026-03-11T00:00:00.000Z'),
        $lte: new Date('2026-04-01T23:59:59.999Z')
      }
    })
  })

  test('maps the facet result to a total and a month series', async () => {
    stubDb({
      total: [{ count: 5 }],
      byMonth: [
        { _id: '2026-03', count: 2 },
        { _id: '2026-04', count: 3 }
      ]
    })

    const result = await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt'
    })

    expect(result).toEqual({
      total: 5,
      byMonth: [
        { month: '2026-03', count: 2 },
        { month: '2026-04', count: 3 }
      ]
    })
  })

  test('reports a zero total when nothing matches, rather than undefined', async () => {
    stubDb({ total: [], byMonth: [] })

    const result = await countByMonth(db, {
      collection: JOURNEY_STARTS_COLLECTION,
      dateField: 'startedAt'
    })

    expect(result).toEqual({ total: 0, byMonth: [] })
  })

  test('refuses the registrations collection, which is counted through the repository', async () => {
    await expect(
      countByMonth(db, {
        collection: OCR_REGISTRATION_COLLECTION,
        dateField: SUBMITTED_AT
      })
    ).rejects.toThrow('Count registrations through the audited repository')
    expect(collection).not.toHaveBeenCalled()
  })
})
