import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/*.test.ts', 'scripts/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{js,ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
})
