import { defineConfig } from "vitest/config";

/**
 * Unit-test config. Fast, hermetic, no Postgres / no Docker required.
 * Integration tests live under test/integration/ and use vitest.integration.config.ts.
 *
 * Coverage scope is explicitly the set of modules Stream E (Quality) owns and
 * has tested end-to-end. Files added by Streams A/C/D/F (entraAuth, workflow
 * executor, ent-tools client, communication/database/generation tools, new
 * route modules) are excluded from the threshold check — their owning streams
 * are responsible for adding their own coverage. Excluded files still appear
 * in the html report so gaps are visible.
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
        // Stream E owns these. Threshold below applies to their lines.
        "src/services/piiDetector.ts",
        "src/services/loopDetector.ts",
        "src/services/promptBuilder.ts",
        "src/services/auditLogger.ts",
        "src/services/llmProvider.ts",
        "src/services/toolDispatcher.ts",
        "src/services/agentOrchestrator.ts",
        "src/middleware/auth.ts",
        "src/middleware/agentRateLimit.ts",
        "src/middleware/requestValidation.ts",
        "src/routes/agent.ts",
        "src/routes/health.ts",
        "src/tools/_shared/ssrf.ts",
        "src/tools/apiProxy.ts",
        "src/tools/documents.ts",
        "src/tools/github.ts",
        "src/tools/register.ts",
        "src/tools/utilities.ts",
        "src/tools/webScrape.ts",
        "src/tools/webSearch.ts",
      ],
      exclude: [
        "src/services/logger.ts",
        "src/services/processMonitor.ts",
        "src/data/**",
        "src/types/**",
        "src/index.ts",
        "src/tools/index.ts",
        "**/*.d.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        // Numbers reflect what's reachable without spinning up the real Anthropic
        // streaming SSE parser, Vertex Gemini streaming, Stream A's full Entra
        // JWT verification path, and pdf-parse/adm-zip binary fixtures. The
        // security-critical modules carry the weight: piiDetector 100%,
        // loopDetector 99%, promptBuilder 98%, auditLogger 99%,
        // requestValidation 98%, register 100%, health 100%.
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
