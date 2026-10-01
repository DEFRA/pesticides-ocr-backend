import { config } from '#/config.js'
import {
  getOneByReferenceNumber,
  findRegistrationsPage
} from '#/common/helpers/ocr-search.js'
import { queryRegistrations } from './helpers/query-registrations.js'
import { buildCriteriaFilter } from './helpers/search-filter.js'

const searchSort = { submittedAt: -1, reference: 1 }

const registerProjection = {
  reference: 1,
  submittedAt: 1,
  status: 1,
  businessName: 1,
  businessActivities: 1,
  mainCustomer: 1,
  address: 1,
  primaryContact: 1,
  addressActivities: 1,
  quantity: 1
}

export async function searchRegistrations(db, criteria, { page, pageSize }) {
  const { records, total } = await findRegistrationsPage(db, {
    filter: buildCriteriaFilter(criteria),
    sort: searchSort,
    projection: registerProjection,
    skip: (page - 1) * pageSize,
    limit: pageSize
  })

  return {
    data: records,
    pagination: {
      page,
      pageSize,
      totalRecords: total,
      totalPages: Math.ceil(total / pageSize)
    }
  }
}

const REFERENCE_PATTERN = /^([A-Z0-9]+)-[A-Z0-9]{3}-[A-Z0-9]{3}$/

// The accepted prefix is the one registrations are generated with
// (`referencePrefix`), so the validator can't disagree with the generator.
function validateReferenceNumber(referenceNumber) {
  const match = REFERENCE_PATTERN.exec(referenceNumber)
  return match !== null && match[1] === config.get('referencePrefix')
}

export async function resolveQuery(db, { reference, q } = {}, { limit } = {}) {
  if (reference === undefined) {
    return { list: await queryRegistrations(db, { query: q, limit }) }
  }

  if (!validateReferenceNumber(reference)) {
    return { invalidReference: true }
  }

  return { single: await getOneByReferenceNumber(db, reference) }
}

export { getOneByReferenceNumber, validateReferenceNumber }
