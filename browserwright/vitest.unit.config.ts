import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 5000, // Unit tests should be fast
    hookTimeout: 2000,
    include: ['test/unit/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
