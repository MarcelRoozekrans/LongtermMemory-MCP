import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Used by `npm run test:coverage`; CI uploads coverage/lcov.info to Codecov.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
  benchmark: {
    include: ["tests/benchmarks/**/*.bench.ts"],
  },
});
