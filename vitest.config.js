import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    // Server start-up in a beforeAll can exceed the default 10s hook timeout on
    // a cold CI runner.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js', 'scripts/**/*.js'],
      exclude: [...configDefaults.exclude, 'coverage']
    },
    globalSetup: ['.vite/mongo-memory-server.js'],
    setupFiles: ['.vite/mongo-reset.js', '.vite/setup-files.js']
  }
})
