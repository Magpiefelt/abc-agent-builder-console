/**
 * ESLint flat config for the backend.
 *
 * Keeps the rule surface deliberately small: catches actual bugs (no-unused-vars,
 * no-var, prefer-const, eqeqeq) while leaving stylistic / opinionated rules off
 * so existing source code passes without churn. typescript-eslint provides the
 * TS-aware unused-vars rule.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setImmediate: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Response: "readonly",
        AbortController: "readonly",
        TextDecoder: "readonly",
        Promise: "readonly",
      },
    },
    rules: {
      // Stylistic / opinionated — keep off for now.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",

      // Allow underscore-prefixed unused params/vars (Express middleware uses _req, _next).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Bug-catchers.
      "no-var": "error",
      "prefer-const": "warn",
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-throw-literal": "error",
    },
  },
  {
    files: ["**/__tests__/**/*.ts", "test/**/*.ts"],
    rules: {
      // Tests get more latitude — vi.fn mock-call indexing produces casts.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
