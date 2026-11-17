import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      // Black-box: spawns the built API + worker against real Postgres/Redis (see docs/TEST_PLAN.md).
      { test: { name: 'integration', include: ['test/integration/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } },
    ],
    coverage: {
      provider: 'v8',
      // Unit coverage gate on the core (domain + use cases + SSRF guard). Controllers and adapters are
      // exercised by the black-box integration suite in separate processes (not counted here, see TEST_PLAN).
      include: ['src/delivery/domain/**', 'src/delivery/application/**', 'src/delivery/infrastructure/ssrf.ts'],
      thresholds: { lines: 90, branches: 85 },
      reporter: ['text-summary', 'lcov'], // lcov is what SonarQube reads
    },
  },
});
