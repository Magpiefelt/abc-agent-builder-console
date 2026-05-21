import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/types/**",
        "src/data/**",
        "src/index.ts",
      ],
    },
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
