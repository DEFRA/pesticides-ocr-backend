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

export const AGRI_SUBSECTOR = Object.freeze({
  ARABLE: 'arable',
  OUTDOOR_VEGETABLES: 'outdoor-vegetables',
  GRASSLANDS_FODDER: 'grasslands-fodder'
})

export const AMENITY_SUBSECTOR = Object.freeze({
  PARKS: 'parks',
  SPORTS_GROUNDS: 'sports-grounds',
  PROPERTY: 'property',
  INFRASTRUCTURE: 'infrastructure',
  UTILITIES: 'utilities'
})

export const HORTI_SUBSECTOR = Object.freeze({
  EDIBLE_PROTECTED: 'edible-protected',
  ORCHARDS_SOFT_FRUIT: 'orchards-soft-fruit',
  ORNAMENTALS: 'ornamentals'
})

export const STORING = Object.freeze({
  OWN: 'own',
  THIRD_PARTY: 'third-party',
  NO: 'no'
})

export const STORAGE_LOCATION = Object.freeze({
  MAIN_ADDRESS: 'main-address',
  MAIN_AND_OTHER: 'main-and-other'
})

// The quantity used in a typical year, as a band of litres or kilograms.
export const QUANTITY_BAND = Object.freeze({
  BAND_1_29: '1-29',
  BAND_30_59: '30-59',
  BAND_60_149: '60-149',
  BAND_150_399: '150-399',
  BAND_400_PLUS: '400-plus'
})

export const ADDRESS_REGION = Object.freeze({
  ENGLAND: 'england',
  SCOTLAND: 'scotland',
  WALES: 'wales'
})

// The old top-level quantity's types. POST /register no longer accepts them;
// only the seed script still does, until it's moved to the usingPPPs shape.
export const QUANTITY_TYPE = Object.freeze({
  AREA: 'area',
  AMOUNT: 'amount'
})

export const BUSINESS_ACTIVITIES = Object.values(BUSINESS_ACTIVITY)
export const ADDRESS_ACTIVITIES = Object.values(ADDRESS_ACTIVITY)
export const WHO_APPLIES_VALUES = Object.values(WHO_APPLIES)
export const PROFESSIONAL_SECTORS = Object.values(PROFESSIONAL_SECTOR)
export const AGRI_SUBSECTORS = Object.values(AGRI_SUBSECTOR)
export const AMENITY_SUBSECTORS = Object.values(AMENITY_SUBSECTOR)
export const HORTI_SUBSECTORS = Object.values(HORTI_SUBSECTOR)
export const STORING_VALUES = Object.values(STORING)
export const STORAGE_LOCATIONS = Object.values(STORAGE_LOCATION)
export const QUANTITY_BANDS = Object.values(QUANTITY_BAND)
export const ADDRESS_REGIONS = Object.values(ADDRESS_REGION)
export const QUANTITY_TYPES = Object.values(QUANTITY_TYPE)
