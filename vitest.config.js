import { defineConfig } from 'vitest/config'

// Plain Node environment — everything under test here is pure calculation
// (shade/safety math, ranking, formatting), not React components, so there's
// no need for jsdom or the React plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js'],
  },
})
