import { MONGO_DUPLICATE_KEY_ERROR } from '#/common/constants/mongo.js'
import { recordEvent } from './record-event.js'
import { sendServerEvent } from './send-server-event.js'
import {
  JOURNEY_STARTS,
  JOURNEY_NOT_ELIGIBLE,
  FEEDBACK_STARTS,
  FEEDBACK_COMPLETIONS
} from './journey-events.js'

vi.mock('./send-server-event.js', () => ({
  sendServerEvent: vi.fn()
}))

test.each([FEEDBACK_STARTS, FEEDBACK_COMPLETIONS])(
  'feedback events are stored without sending to GA4 ($collection)',
  async (event) => {
    sendServerEvent.mockReset()
    const insertOne = vi.fn().mockResolvedValue({})
    const db = { collection: vi.fn().mockReturnValue({ insertOne }) }

    expect(await recordEvent(db, event, 'feedback-nonce')).toBe(true)
    expect(insertOne).toHaveBeenCalledExactlyOnceWith({
      [event.dateField]: expect.any(Date),
      nonce: 'feedback-nonce'
    })
    expect(sendServerEvent).not.toHaveBeenCalled()
  }
)

describe.each([JOURNEY_STARTS, JOURNEY_NOT_ELIGIBLE])(
  'recordEvent $eventName',
  (event) => {
    let insertOne
    let db

    beforeEach(() => {
      insertOne = vi.fn().mockResolvedValue({})
      db = { collection: vi.fn().mockReturnValue({ insertOne }) }
      sendServerEvent.mockReset()
    })

    test('sends the stored timestamp only after insertion succeeds', async () => {
      let completeInsert
      insertOne.mockReturnValue(
        new Promise((resolve) => {
          completeInsert = resolve
        })
      )
      const recording = recordEvent(db, event, 'session-nonce')

      expect(sendServerEvent).not.toHaveBeenCalled()
      completeInsert({})
      expect(await recording).toBe(true)
      expect(db.collection).toHaveBeenCalledWith(event.collection)
      const [document] = insertOne.mock.calls[0]
      expect(document.nonce).toBe('session-nonce')
      expect(sendServerEvent).toHaveBeenCalledExactlyOnceWith(
        event.eventName,
        document[event.dateField]
      )
    })

    test('does not wait for GA delivery', async () => {
      sendServerEvent.mockReturnValue(new Promise(() => {}))

      await expect(recordEvent(db, event)).resolves.toBe(true)
      expect(sendServerEvent).toHaveBeenCalledTimes(1)
    })

    test('sends nothing for a deduplicated replay', async () => {
      insertOne.mockRejectedValue(
        Object.assign(new Error('duplicate nonce'), {
          code: MONGO_DUPLICATE_KEY_ERROR
        })
      )

      await expect(recordEvent(db, event, 'session-nonce')).resolves.toBe(false)
      expect(sendServerEvent).not.toHaveBeenCalled()
    })

    test('sends nothing when insertion fails', async () => {
      insertOne.mockRejectedValue(new Error('database unavailable'))

      await expect(recordEvent(db, event)).rejects.toThrow(
        'database unavailable'
      )
      expect(sendServerEvent).not.toHaveBeenCalled()
    })
  }
)
