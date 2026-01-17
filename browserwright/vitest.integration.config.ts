import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // Integration tests need more time
    hookTimeout: 10000,
    include: ['test/integration/**/*.test.ts'],
    exclude: ['node_modules/**'],
    env: {
      BROWSERWRIGHT_NODE_ENV: 'development',
    },
  },
})
