/**
 * Vitest globalSetup — runs once before any test file.
 *
 * - In CI: reuse the Postgres service container via CI_TEST_DATABASE_URL.
 * - Locally: spin up a throwaway testcontainers Postgres (requires Docker).
 *
 * Either way, runs the migration script against a fresh schema and exports
 * DATABASE_URL + DB_SCHEMA for the tests. Hard-fails if anything points at the
 * Render shared schema (production safeguard).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import pg from "pg";
import type { StartedTestContainer } from "testcontainers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = resolve(__dirname, "../../docs/02_database_migrations.sql");

let container: StartedTestContainer | null = null;

function refuseProductionTargets(url: string): void {
  const blocklist = ["render.com", "rds.amazonaws.com"];
  for (const host of blocklist) {
    if (url.includes(host)) {
      throw new Error(
        `Refusing to run tests against a production-looking host (${host}). ` +
          `Override CI_TEST_DATABASE_URL to a disposable instance.`
      );
    }
  }
}

async function applyMigrations(connectionString: string, schema: string): Promise<void> {
  const { Pool } = pg;
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);

    const raw = readFileSync(MIGRATION_FILE, "utf-8");
    const adjusted = raw.replace(/cohen_mcleod/g, schema);
    await pool.query(adjusted);
  } finally {
    await pool.end();
  }
}

export async function setup(): Promise<void> {
  const schema = process.env.DB_SCHEMA || "test_abc";
  process.env.DB_SCHEMA = schema;

  if (process.env.CI_TEST_DATABASE_URL) {
    refuseProductionTargets(process.env.CI_TEST_DATABASE_URL);
    process.env.DATABASE_URL = process.env.CI_TEST_DATABASE_URL;
    await applyMigrations(process.env.DATABASE_URL, schema);
    return;
  }

  // Local: start testcontainers Postgres
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("abc_test")
    .withUsername("abc_test")
    .withPassword("abc_test")
    .start();

  const url = (container as unknown as { getConnectionUri: () => string }).getConnectionUri();
  refuseProductionTargets(url);
  process.env.DATABASE_URL = url;
  await applyMigrations(url, schema);
}

export async function teardown(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
  }
}
