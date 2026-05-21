/**
 * Vitest setupFiles — runs once per worker before each test file.
 *
 * Sets the env knobs the production code reads (MOCK_LLM=1, NODE_ENV=test).
 * The globalSetup has already exported DATABASE_URL and DB_SCHEMA.
 */

process.env.NODE_ENV = "test";
process.env.MOCK_LLM = "1";

// Tests should never reach the live Vertex AI / Anthropic / Google APIs.
// Stub the keys so isProviderConfigured() returns true without prompting any provider.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key-mock";
process.env.VERTEX_AI_API_KEY = process.env.VERTEX_AI_API_KEY || "test-key-mock";

// Silence the structured logger during tests unless explicitly opted-in.
if (process.env.LOG_IN_TESTS !== "1") {
  const noop = (): void => {};
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.debug = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  (globalThis as Record<string, unknown>).__originalConsole = original;
}
