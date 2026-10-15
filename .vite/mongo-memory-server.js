import { setup as startMongo, teardown as stopMongo } from 'vitest-mongodb'

export async function setup() {
  await startMongo({
    type: 'replSet',
    serverOptions: { replSet: { count: 1, storageEngine: 'wiredTiger' } }
  })
  process.env.MONGO_URI = globalThis.__MONGO_URI__
}

export const teardown = stopMongo
