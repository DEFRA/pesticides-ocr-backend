import { getOperatorByReference } from './reference.js'
import { toOperator } from '#/services/operators/helpers/operator-mapper.js'
import { storedDoc } from '#/services/operators/operators.fixtures.js'

describe('#getOperatorByReference (GET /operators/{reference} controller)', () => {
  let findOne
  let collection
  let db

  beforeEach(() => {
    findOne = vi.fn()
    collection = vi.fn().mockReturnValue({ findOne })
    db = { collection }
  })

  test('looks up ocr-registration by reference and maps to the Operator contract', async () => {
    findOne.mockResolvedValue(storedDoc)

    const result = await getOperatorByReference(db, 'PPP-A1B-2C3')

    expect(collection).toHaveBeenCalledWith('ocr-registration')
    expect(findOne).toHaveBeenCalledWith(
      { reference: 'PPP-A1B-2C3' },
      { projection: { _id: 0 } }
    )
    expect(result).toEqual(toOperator(storedDoc))
  })

  test('returns null when no registration matches', async () => {
    findOne.mockResolvedValue(null)

    expect(await getOperatorByReference(db, 'PPP-ZZZ-999')).toBeNull()
  })
})
