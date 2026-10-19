import { monthlyCountsPipeline, toMonthlyCounts } from './monthly-counts.js'

describe('#monthlyCountsPipeline', () => {
  test.each([undefined, null, {}, { dateField: '' }, { dateField: 42 }])(
    'rejects %s as the options',
    (options) => {
      expect(() => monthlyCountsPipeline(options)).toThrow(
        'dateField must be a non-empty string'
      )
    }
  )

  test('groups by month on the date field, with no match when unbounded', () => {
    const [facet] = monthlyCountsPipeline({ dateField: 'startedAt' })

    expect(facet.$facet.byMonth[0].$group._id).toEqual({
      $dateToString: { format: '%Y-%m', date: '$startedAt' }
    })
  })

  test('matches the whole from day through the whole to day', () => {
    const [match] = monthlyCountsPipeline({
      dateField: 'startedAt',
      from: '2026-04-01',
      to: '2026-04-30'
    })

    expect(match).toEqual({
      $match: {
        startedAt: {
          $gte: new Date('2026-04-01T00:00:00.000Z'),
          $lte: new Date('2026-04-30T23:59:59.999Z')
        }
      }
    })
  })
})

describe('#toMonthlyCounts', () => {
  test('gives a zero total when nothing matched', () => {
    expect(toMonthlyCounts({ total: [], byMonth: [] })).toEqual({
      total: 0,
      byMonth: []
    })
  })
})
