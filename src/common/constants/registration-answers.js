export const BUSINESS_ACTIVITY = Object.freeze({
  USING: 'using',
  SELLING: 'selling'
})

export const ADDRESS_ACTIVITY = Object.freeze({
  USE: 'use',
  STORE: 'store',
  RECORDS: 'records'
})

export const QUANTITY_TYPE = Object.freeze({
  AREA: 'area',
  AMOUNT: 'amount'
})

export const ADDRESS_REGION = Object.freeze({
  ENGLAND: 'england',
  SCOTLAND: 'scotland',
  WALES: 'wales'
})

export const WHO_APPLIES = Object.freeze({
  SELF: 'self',
  CONTRACTOR: 'contractor'
})

export const PROFESSIONAL_SECTOR = Object.freeze({
  AGRICULTURE: 'agriculture',
  AMENITY: 'amenity',
  BUSINESS_PREMISES: 'business-premises',
  FORESTRY: 'forestry',
  HORTICULTURE: 'horticulture',
  PUBLIC_SERVICES: 'public-services',
  SCHOOLS_UNIVERSITIES: 'schools-universities',
  SPORTS_CLUBS: 'sports-clubs'
})

export const AGRI_SUBSECTORS = Object.freeze([
  'arable',
  'outdoor-vegetables',
  'grasslands-fodder',
  'potatoes'
])

export const AMENITY_SUBSECTORS = Object.freeze([
  'gardens-lawncare',
  'infrastructure-transport',
  'site-property-maintenance',
  'sports-public-amenity'
])

export const HORTI_SUBSECTORS = Object.freeze([
  'edible-protected',
  'orchards',
  'ornamentals',
  'soft-fruits',
  'viticulture'
])

export const MEMBER_SCHEMES = Object.freeze([
  'red-tractor',
  'leaf',
  'soil-association-organic',
  'sqc'
])

export const STORING = Object.freeze({
  OWN: 'own',
  THIRD_PARTY: 'third-party',
  NONE: 'no'
})

export const STORAGE_LOCATION = Object.freeze({
  MAIN_ADDRESS: 'main-address',
  ANOTHER_ADDRESS: 'another-address'
})

export const USING_QUANTITIES = Object.freeze([
  '1-29',
  '30-59',
  '60-149',
  '150-399',
  '400-plus'
])

export const BUSINESS_ACTIVITIES = Object.values(BUSINESS_ACTIVITY)
export const ADDRESS_ACTIVITIES = Object.values(ADDRESS_ACTIVITY)
export const QUANTITY_TYPES = Object.values(QUANTITY_TYPE)
export const ADDRESS_REGIONS = Object.values(ADDRESS_REGION)
export const WHO_APPLIES_VALUES = Object.values(WHO_APPLIES)
export const PROFESSIONAL_SECTORS = Object.values(PROFESSIONAL_SECTOR)
export const STORING_VALUES = Object.values(STORING)
export const STORAGE_LOCATIONS = Object.values(STORAGE_LOCATION)
