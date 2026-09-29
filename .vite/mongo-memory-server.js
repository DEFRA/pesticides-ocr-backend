import { afterAll, beforeAll } from 'vitest'
import { setup, teardown } from 'vitest-mongodb'

beforeAll(async () => {
  // Setup mongo mock
  await setup({
    serverOptions: {
      binary: {
        version: '7.0.24'
      },
      // Windows Defender / disk contention can make mongod take longer than
      // the 10s default to report itself ready, causing flaky hook timeouts.
      instance: { launchTimeout: 30000 },
      autoStart: false
    }
  })
  process.env.MONGO_URI = globalThis.__MONGO_URI__
})

afterAll(async () => {
  await teardown()
})
