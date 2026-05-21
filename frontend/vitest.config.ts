import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("goa-"),
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: "jsdom",
    include: [
      "src/**/__tests__/*.test.ts",
      "test/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "src/stores/**/*.ts",
        "src/components/**/*.vue",
        "src/views/**/*.vue",
        "src/composables/**/*.ts",
      ],
      exclude: ["**/*.d.ts", "**/__tests__/**"],
    },
  },
});
