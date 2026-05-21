/**
 * Environment Configuration
 * 
 * Zod-validated environment variables with sensible defaults for development.
 * All secrets and configuration are loaded here and exported as a typed object.
 * 
 * Categories:
 * - Server: port, environment, frontend URL
 * - Database: connection string, schema
 * - Authentication: Entra ID OIDC credentials
 * - LLM Providers: API keys for Claude, Gemini, etc.
 * - Tool API Keys: search, TTS, etc.
 * - Orchestration: timeouts, limits
 */

import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // ============================================================================
  // SERVER
  // ============================================================================
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  // ============================================================================
  // DATABASE
  // ============================================================================
  DATABASE_URL: z.string().url().optional(),
  DB_SCHEMA: z.string().default("cohen_mcleod"),

  // ============================================================================
  // AUTHENTICATION (Microsoft Entra ID)
  // ============================================================================
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_REDIRECT_URI: z.string().url().optional(),
  SESSION_SECRET: z.string().default("dev-secret-change-in-production"),

  // ============================================================================
  // LLM PROVIDERS
  // ============================================================================
  /** Vertex AI API key (for Claude via Vertex or Gemini via Vertex) */
  VERTEX_AI_API_KEY: z.string().optional(),
  /** Vertex AI project ID (for proper Vertex AI endpoint routing) */
  VERTEX_AI_PROJECT_ID: z.string().optional(),
  /** Vertex AI region (default: northamerica-northeast1 for Canadian data residency) */
  VERTEX_AI_REGION: z.string().default("northamerica-northeast1"),
  /** Direct Anthropic API key (fallback if not using Vertex AI) */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Google AI API key (for Gemini via Google AI Studio) */
  GOOGLE_AI_API_KEY: z.string().optional(),

  // ============================================================================
  // TOOL API KEYS
  // ============================================================================
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_SEARCH_CX: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  // ============================================================================
  // GoA ENTERPRISE TOOLS (proxy for Brave / image generation)
  // ============================================================================
  ENT_TOOLS_API_KEY: z.string().optional(),
  ENT_TOOLS_BASE_URL: z.string().url().default("https://ent-tools.sandbox.aim.int.gov.ab.ca"),

  // ============================================================================
  // EMAIL (SMTP)
  // ============================================================================
  EMAIL_FROM: z.string().optional(),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().default(587),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASS: z.string().optional(),
  EMAIL_SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "string" ? v === "true" || v === "1" : v))
    .default(false),

  // ============================================================================
  // API PROXY ALLOWLIST (optional)
  // ============================================================================
  /** Comma-separated host list for get_call_api / post_call_api. Supports `*.example.com`. */
  API_PROXY_ALLOWLIST: z.string().optional(),

  // ============================================================================
  // ORCHESTRATION CONFIGURATION
  // ============================================================================
  /** Maximum iterations per agent session (hard cap) */
  MAX_ITERATIONS_LIMIT: z.coerce.number().default(100),
  /** LLM call timeout in milliseconds */
  LLM_TIMEOUT_MS: z.coerce.number().default(120000), // 2 minutes
  /** Tool execution timeout in milliseconds */
  TOOL_TIMEOUT_MS: z.coerce.number().default(30000), // 30 seconds
  /** Maximum concurrent agent sessions per user */
  MAX_CONCURRENT_SESSIONS: z.coerce.number().default(3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("╔══════════════════════════════════════════════════════╗");
  console.error("║   INVALID ENVIRONMENT VARIABLES                      ║");
  console.error("╚══════════════════════════════════════════════════════╝");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;

/**
 * Check if any LLM provider is configured.
 */
export function hasLLMProvider(): boolean {
  return !!(env.VERTEX_AI_API_KEY || env.ANTHROPIC_API_KEY || env.GOOGLE_AI_API_KEY);
}

/**
 * Get a summary of configured services (for health checks / startup logging).
 */
export function getConfigSummary(): Record<string, boolean> {
  return {
    database: !!env.DATABASE_URL,
    entraId: !!(env.ENTRA_CLIENT_ID && env.ENTRA_TENANT_ID),
    vertexAi: !!env.VERTEX_AI_API_KEY,
    anthropic: !!env.ANTHROPIC_API_KEY,
    googleAi: !!env.GOOGLE_AI_API_KEY,
    braveSearch: !!env.BRAVE_SEARCH_API_KEY,
    googleSearch: !!(env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_CX),
    elevenLabs: !!env.ELEVENLABS_API_KEY,
    github: !!env.GITHUB_TOKEN,
    entTools: !!env.ENT_TOOLS_API_KEY,
    smtp: !!(env.EMAIL_SMTP_HOST && env.EMAIL_SMTP_USER && env.EMAIL_SMTP_PASS),
    apiProxyAllowlist: !!env.API_PROXY_ALLOWLIST,
  };
}
