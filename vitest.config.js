import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    // Server + in-memory Mongo spin-up in a beforeAll can exceed vitest's default
    // 10s hook timeout on a cold/contended CI runner (fine locally). Give the
    // integration tests' hooks headroom so they don't flake.
    testTimeout: 30000, // 30 seconds for individual tests
    hookTimeout: 180000, // 3 minutes for setup/teardown hooks
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js', 'scripts/**/*.js'],
      exclude: [...configDefaults.exclude, 'coverage']
    },
    setupFiles: ['.vite/mongo-memory-server.js', '.vite/setup-files.js']
  }
})
