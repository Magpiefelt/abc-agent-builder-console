import { defineConfig } from "vitest/config";

/**
 * Unit-test config. Fast, hermetic, no Postgres / no Docker required.
 * Integration tests live under test/integration/ and use vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
    exclude: ["node_modules", "dist", "test/integration/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "src/services/**/*.ts",
        "src/middleware/**/*.ts",
        "src/routes/**/*.ts",
        "src/tools/**/*.ts",
      ],
      exclude: [
        "src/services/logger.ts",
        "src/services/processMonitor.ts",
        "src/data/**",
        "src/types/**",
        "src/index.ts",
        "**/*.d.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 70,
        branches: 65,
      },
    },
  },
});
