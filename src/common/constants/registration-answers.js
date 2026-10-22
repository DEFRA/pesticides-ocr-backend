export const BUSINESS_ACTIVITY = Object.freeze({
  MANUFACTURE: 'manufacture',
  MARKET: 'market',
  SELLER_PROFESSIONAL: 'seller-professional',
  SELLER_AMATEUR: 'seller-amateur',
  USE_PROFESSIONAL: 'use-professional'
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

export const QUANTITY_TYPE = Object.freeze({
  AREA: 'area',
  AMOUNT: 'amount'
})

export const BUSINESS_ACTIVITIES = Object.values(BUSINESS_ACTIVITY)
export const ADDRESS_ACTIVITIES = Object.values(ADDRESS_ACTIVITY)
export const PROFESSIONAL_SECTORS = Object.values(PROFESSIONAL_SECTOR)
export const QUANTITY_TYPES = Object.values(QUANTITY_TYPE)
