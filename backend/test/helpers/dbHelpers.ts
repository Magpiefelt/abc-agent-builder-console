/**
 * Test database helpers. Operates against the schema spun up by globalSetup.ts.
 */

import { query } from "../../src/config/database.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function truncateAll(): Promise<void> {
  // Truncate application tables. The seed planning tables (plan, vulnerabilities,
  // privacy_controls, migration) we leave alone — they're metadata.
  await query(`TRUNCATE
    agent_iterations,
    artifacts,
    agent_sessions,
    audit_log,
    pii_detections,
    workflows,
    model_registry,
    users
    RESTART IDENTITY CASCADE`);
}

export async function seedUser(opts: Partial<{ id: string; email: string; ministry: string; role: string }> = {}): Promise<{ id: string; email: string; ministry: string }> {
  const id = opts.id || DEV_USER_ID;
  const email = opts.email || "cohen.mcleod@gov.ab.ca";
  const ministry = opts.ministry || "INFRA";
  const role = opts.role || "admin";

  await query(
    `INSERT INTO users (id, entra_id, email, display_name, ministry_code, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, `entra-${id}`, email, "Test User", ministry, role]
  );
  return { id, email, ministry };
}

/**
 * Seed the mock LLM model used by integration tests. Stays inside the
 * existing provider enum (anthropic) but is recognised by display_name="Mock LLM"
 * and model_id="mock-llm".
 */
export async function seedMockModel(
  opts: Partial<{ classification: "unclassified" | "protected_a" | "protected_b"; residency: string }> = {}
): Promise<void> {
  await query(
    `INSERT INTO model_registry (model_id, display_name, provider, api_model_name, max_output_tokens,
                                 supports_streaming, supports_tools, data_residency, max_classification, is_active)
     VALUES ('mock-llm', 'Mock LLM', 'anthropic', 'mock-model', 8192, true, true, $1, $2, true)
     ON CONFLICT (model_id) DO UPDATE
       SET data_residency = EXCLUDED.data_residency,
           max_classification = EXCLUDED.max_classification,
           is_active = true`,
    [opts.residency || "canada", opts.classification || "protected_b"]
  );
}

/**
 * Seed a US-residency mock model that can only handle unclassified data —
 * used for classification-routing scenario tests.
 */
export async function seedUsResidencyMockModel(): Promise<void> {
  await query(
    `INSERT INTO model_registry (model_id, display_name, provider, api_model_name, max_output_tokens,
                                 supports_streaming, supports_tools, data_residency, max_classification, is_active)
     VALUES ('mock-llm-us', 'Mock LLM (US)', 'anthropic', 'mock-model-us', 8192, true, true, 'us', 'unclassified', true)
     ON CONFLICT (model_id) DO UPDATE SET is_active = true`
  );
}

/** Re-set the active sessions registry in the orchestrator (used between tests). */
export async function clearActiveSessions(): Promise<void> {
  // No-op for now; activeSessions is a private module-level Map. Tests that need
  // it cleared between cases should import stopSession() and call it themselves.
}
