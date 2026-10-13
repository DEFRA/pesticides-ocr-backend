import { beforeAll } from 'vitest'
import { MongoClient } from 'mongodb'

const SYSTEM_DATABASES = new Set(['admin', 'config', 'local'])

// Test files share one Mongo server, so each starts from empty databases.
beforeAll(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI)
  try {
    const { databases } = await client.db().admin().listDatabases()
    await Promise.all(
      databases
        .filter(({ name }) => !SYSTEM_DATABASES.has(name))
        .map(({ name }) => client.db(name).dropDatabase())
    )
  } finally {
    await client.close()
  }
})
