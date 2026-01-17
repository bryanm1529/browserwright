import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000, // Performance tests can take longer
    hookTimeout: 30000,
    include: ['test/performance/**/*.bench.ts', 'test/performance/**/*.test.ts'],
    exclude: ['node_modules/**'],
    benchmark: {
      include: ['test/performance/**/*.bench.ts'],
    },
  },
})
