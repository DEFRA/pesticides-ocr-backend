import { getRegistrationHistory } from './history.js'

describe('getRegistrationHistory', () => {
  const reference = 'PPP-HIS-001'
  let registrations

  beforeEach(() => {
    registrations = {
      listHistory: vi.fn(),
      findByReference: vi.fn()
    }
  })

  test('requests only one page and one look-ahead entry from the repository', async () => {
    registrations.listHistory.mockResolvedValue([
      { version: 9 },
      { version: 7 },
      { version: 3 }
    ])

    const result = await getRegistrationHistory(registrations, reference, {
      pageSize: 2,
      beforeVersion: 10
    })

    expect(registrations.listHistory).toHaveBeenCalledExactlyOnceWith(
      reference,
      { limit: 3, beforeVersion: 10 }
    )
    expect(registrations.findByReference).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: [{ version: 9 }, { version: 7 }],
      pagination: { pageSize: 2, nextBeforeVersion: 7 }
    })
  })

  test('does not advertise a next page when exactly pageSize entries remain', async () => {
    registrations.listHistory.mockResolvedValue([
      { version: 2 },
      { version: 1 }
    ])

    expect(
      await getRegistrationHistory(registrations, reference, { pageSize: 2 })
    ).toEqual({
      data: [{ version: 2 }, { version: 1 }],
      pagination: { pageSize: 2, nextBeforeVersion: null }
    })
  })

  test.each([undefined, 1])(
    'returns null for an empty history query without registration or fallback reads (beforeVersion=%s)',
    async (beforeVersion) => {
      registrations.listHistory.mockResolvedValue([])

      expect(
        await getRegistrationHistory(registrations, reference, {
          pageSize: 50,
          beforeVersion
        })
      ).toBeNull()
      expect(registrations.findByReference).not.toHaveBeenCalled()
      expect(registrations.listHistory).toHaveBeenCalledExactlyOnceWith(
        reference,
        { limit: 51, beforeVersion }
      )
    }
  )

  test('propagates repository failures rather than returning an empty history', async () => {
    registrations.listHistory.mockRejectedValue(
      new Error('database unavailable')
    )

    await expect(
      getRegistrationHistory(registrations, reference, { pageSize: 2 })
    ).rejects.toThrow('database unavailable')
  })
})
