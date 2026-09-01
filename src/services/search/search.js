import { config } from '#/config.js'

function validateReferenceNumber(referenceNumber) {
  if (config.get('isDevelopment')) {
    const referenceNumberPatternDev = /^SED-[A-Z0-9]{3}-[A-Z0-9]{3}$/
    return referenceNumberPatternDev.test(referenceNumber)
  }

  const referenceNumberPattern = /^PPP-[A-Z0-9]{3}-[A-Z0-9]{3}$/
  return referenceNumberPattern.test(referenceNumber)
}

function getOneByReferenceNumber(db, referenceNumber) {
  return db
    .collection('ocr-registration')
    .findOne({ reference: referenceNumber }, { projection: { _id: 0 } })
}

export { getOneByReferenceNumber, validateReferenceNumber }
