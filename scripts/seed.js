/**
 * Seed script — inserts sample registration records into MongoDB.
 * References use the 'SED' prefix (SED-XXX-XXX) to distinguish seeded data.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/seed.js
 *   node --env-file-if-exists=.env scripts/seed.js --count=20
 */

import { MongoClient, ServerApiVersion } from 'mongodb'
import { randomInt } from 'crypto'
import { fileURLToPath } from 'url'

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/'
const MONGO_DATABASE = process.env.MONGO_DATABASE ?? 'pesticides-ocr-backend'
export const SEED_PREFIX = 'SED'
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MONGO_DUPLICATE_KEY_ERROR = 11000

export const DEFAULT_COUNT = 10

export function parseSeedArgs(argv) {
  const countArg = argv.find((a) => a.startsWith('--count='))?.split('=')[1]
  return countArg ? parseInt(countArg, 10) : DEFAULT_COUNT
}

export function generateReference() {
  const segment = () =>
    Array.from({ length: 3 }, () => CHARS[randomInt(CHARS.length)]).join('')
  return `${SEED_PREFIX}-${segment()}-${segment()}`
}

export function pickRandom(arr) {
  return arr[randomInt(arr.length)]
}

export function pickSubset(arr) {
  const count = randomInt(1, arr.length + 1)
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count)
}

export function buildRecord() {
  const businessActivitiesPool = [
    'manufacture',
    'market',
    'seller-professional',
    'seller-amateur',
    'use-professional'
  ]
  const addressActivitiesPool = ['use', 'store', 'records']
  const professionalSectorsPool = [
    'agriculture-horticulture',
    'amenity',
    'forestry'
  ]
  const quantityTypes = ['area', 'amount']
  const counties = ['North Yorkshire', 'Devon', 'Kent', 'Cheshire', 'Suffolk']
  const memberSchemePool = [
    'red-tractor',
    'leaf',
    'soil-association-organic',
    'sqc'
  ]

  const includeAdditional = Math.random() > 0.5
  const includeSectors = Math.random() > 0.4
  const includeSchemes = Math.random() > 0.5

  return {
    businessActivities: pickSubset(businessActivitiesPool),
    businessName: `Seed Company ${randomInt(1, 999)}`,
    address: {
      line1: `${randomInt(1, 200)} Seed Street`,
      line2: Math.random() > 0.5 ? 'Seed Village' : undefined,
      town: pickRandom(['London', 'York', 'Exeter', 'Chester', 'Ipswich']),
      county: Math.random() > 0.4 ? pickRandom(counties) : undefined,
      postcode: pickRandom([
        'AB12 3CD',
        'SW1A 2AA',
        'EX1 1AA',
        'CH1 1AA',
        'IP1 1AA'
      ])
    },
    primaryContact: {
      name: pickRandom(['Alice Seed', 'Bob Seed', 'Carol Seed', 'Dave Seed']),
      telephone: `0${randomInt(1000000000, 9999999999)}`,
      email: `seed${randomInt(1, 9999)}@example.com`
    },
    addressActivities: pickSubset(addressActivitiesPool),
    quantity: {
      quantityType: pickRandom(quantityTypes),
      quantity: String(randomInt(1, 500))
    },
    ...(includeSectors && {
      professionalSectors: pickSubset(professionalSectorsPool)
    }),
    ...(includeSchemes && {
      memberSchemes: pickSubset(memberSchemePool)
    }),
    ...(includeAdditional && {
      additionalAddresses: [
        {
          address: {
            line1: `${randomInt(1, 200)} Extra Road`,
            town: pickRandom(['Leeds', 'Bristol', 'Oxford', 'Derby']),
            postcode: pickRandom(['LS1 1AA', 'BS1 1AA', 'OX1 1AA', 'DE1 1AA'])
          },
          contact: {
            name: pickRandom(['Extra Alice', 'Extra Bob', 'Extra Carol']),
            telephone: `0${randomInt(1000000000, 9999999999)}`,
            email: `extra${randomInt(1, 9999)}@example.com`
          },
          activity: pickSubset(addressActivitiesPool)
        }
      ]
    })
  }
}

export async function seed(
  count,
  mongoUri = MONGO_URI,
  mongoDatabase = MONGO_DATABASE
) {
  const client = new MongoClient(mongoUri, {
    serverApi: ServerApiVersion.v1
  })

  try {
    await client.connect()
    const db = client.db(mongoDatabase)
    const collection = db.collection('ocr-registration')

    await collection.createIndex({ reference: 1 }, { unique: true })

    let inserted = 0

    while (inserted < count) {
      const reference = generateReference()
      try {
        await collection.insertOne({
          ...buildRecord(),
          reference,
          submittedAt: new Date()
        })
        inserted++
        console.log(`[seed] Inserted ${reference}`)
      } catch (err) {
        if (
          err.code !== MONGO_DUPLICATE_KEY_ERROR ||
          !err.keyPattern?.reference
        ) {
          throw err
        }
      }
    }

    console.log(
      `\n[seed] Done — ${inserted} record(s) inserted into '${mongoDatabase}'.`
    )
  } finally {
    await client.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = parseSeedArgs(process.argv)

  if (!Number.isInteger(count) || count < 1) {
    console.error('[seed] --count must be a positive integer')
    process.exit(1)
  }

  seed(count).catch((err) => {
    console.error('[seed] Failed:', err.message)
    process.exit(1)
  })
}
