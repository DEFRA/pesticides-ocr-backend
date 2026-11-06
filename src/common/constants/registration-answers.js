export const BUSINESS_ACTIVITY = Object.freeze({
  USING: 'using',
  MANUFACTURING: 'manufacturing',
  IMPORTING: 'importing',
  PROCESSING: 'processing',
  SELLING: 'selling',
  DISTRIBUTING: 'distributing',
  ONLY_STORING: 'only-storing'
})

export const ADDRESS_ACTIVITY = Object.freeze({
  USE: 'use',
  STORE: 'store',
  RECORDS: 'records'
})

export const PROFESSIONAL_SECTOR = Object.freeze({
  AGRICULTURE_HORTICULTURE: 'agriculture-horticulture',
  AMENITY: 'amenity',
  FORESTRY: 'forestry'
})

export const ADDRESS_REGION = Object.freeze({
  ENGLAND: 'england',
  SCOTLAND: 'scotland',
  WALES: 'wales'
})

export const QUANTITY_TYPE = Object.freeze({
  AREA: 'area',
  AMOUNT: 'amount'
})

export const BUSINESS_ACTIVITIES = Object.values(BUSINESS_ACTIVITY)
export const ADDRESS_ACTIVITIES = Object.values(ADDRESS_ACTIVITY)
export const PROFESSIONAL_SECTORS = Object.values(PROFESSIONAL_SECTOR)
export const ADDRESS_REGIONS = Object.values(ADDRESS_REGION)
export const QUANTITY_TYPES = Object.values(QUANTITY_TYPE)
