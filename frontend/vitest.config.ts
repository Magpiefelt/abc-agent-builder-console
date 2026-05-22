import { defineConfig } from "vitest/config";
import { createLogger } from "vite";
import vue from "@vitejs/plugin-vue";
import * as sfcCompiler from "vue/compiler-sfc";
import { fileURLToPath, URL } from "node:url";

// Mirror vite.config.ts: GoA web components project table semantics through
// a shadow-DOM <table>, but Vue's compiler doesn't know that and emits a
// benign "<thead> cannot be child of <goa-table>" tip. Wrap compileTemplate
// so the tip never reaches plugin-vue's warn — this works under vitest too,
// where vitest replaces customLogger and our logger-level filter is bypassed.
const GOA_NESTING_WARNING = /cannot be child of <goa-/;

const filteringCompiler: typeof sfcCompiler = {
  ...sfcCompiler,
  compileTemplate(options) {
    const result = sfcCompiler.compileTemplate(options);
    if (result.tips?.length) {
      result.tips = result.tips.filter((tip) => !GOA_NESTING_WARNING.test(tip));
    }
    return result;
  },
};

function makeFilteredLogger() {
  const base = createLogger();
  const wrap = (orig: typeof base.warn): typeof base.warn => (msg, opts) => {
    if (typeof msg === "string" && GOA_NESTING_WARNING.test(msg)) return;
    orig(msg, opts);
  };
  return {
    ...base,
    warn: wrap(base.warn.bind(base)),
    warnOnce: wrap(base.warnOnce.bind(base)),
  };
}

export default defineConfig({
  customLogger: makeFilteredLogger(),
  plugins: [
    vue({
      compiler: filteringCompiler,
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("goa-"),
        },
      },
    }),
  ],
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (GOA_NESTING_WARNING.test(warning.message)) return;
        defaultHandler(warning);
      },
    },
  },
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
