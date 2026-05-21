import { defineConfig } from "vitest/config";

/**
 * Integration-test config. Spins up Postgres (testcontainers locally, service
 * container via CI_TEST_DATABASE_URL in CI) and applies migrations once per
 * run via globalSetup.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
