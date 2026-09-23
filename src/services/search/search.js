import { config } from '#/config.js'
import { getOneByReferenceNumber } from '#/common/helpers/ocr-search.js'

// --- Basic reference lookup (EQ-366) ---------------------------------------
//
// Reference-format validation for basic search. The collection access itself
// (getOneByReferenceNumber) lives in the shared ocr-search helper so the
// dashboard read API reuses the same lookup; it is re-exported here so the
// /search route keeps a single import from its own service.

function validateReferenceNumber(referenceNumber) {
  if (config.get('isDevelopment')) {
    const referenceNumberPatternDev = /^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/
    return referenceNumberPatternDev.test(referenceNumber)
  }

  const referenceNumberPattern = /^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/
  return referenceNumberPattern.test(referenceNumber)
}

export { getOneByReferenceNumber, validateReferenceNumber }
