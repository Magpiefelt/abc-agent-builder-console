/**
 * Database Tools
 *
 * `execute_sql` runs a parameterized query against an approved external
 * connection. `read_database_schemas` lists tables and columns via
 * information_schema. Both restrict access to entries listed in
 * `backend/src/data/connectionAllowlist.json` and gated by the caller's
 * ministry code.
 *
 * Security:
 * - Parameterized SQL only. The `sql` string must use $1, $2 placeholders.
 * - Per-call statement_timeout of 10s.
 * - Read-only transactions by default (callers must opt-in with `isWrite: true`
 *   AND the allowlist entry must not be marked `readOnly`).
 * - Row cap (default 1000, hard ceiling 1000).
 * - Pool cached per connection name; small (max=3) and idle-closed at 30s.
 */

import pg from "pg";
import { logger } from "../services/logger.js";
import type { ToolContext } from "../services/toolDispatcher.js";
import allowlist from "../data/connectionAllowlist.json" with { type: "json" };
import { isPrivateOrReservedHost } from "./_shared/ssrf.js";

const { Pool } = pg;

// ============================================================================
// TYPES
// ============================================================================

export interface ConnectionAllowlistEntry {
  name: string;
  connectionEnv: string;
  ministries: string[];
  readOnly?: boolean;
  description?: string;
}

export interface ExecuteSqlResult {
  success: boolean;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  fields?: Array<{ name: string; dataTypeID: number }>;
  truncated?: boolean;
  error?: string;
}

export interface SchemasResult {
  success: boolean;
  schemas?: Array<{
    schema: string;
    tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }>;
  }>;
  error?: string;
}

const MAX_ROWS_HARD_CAP = 1000;
const STATEMENT_TIMEOUT_MS = 10_000;

// ============================================================================
// POOL CACHE
// ============================================================================

const poolCache: Map<string, pg.Pool> = new Map();

/**
 * Close every cached connection pool. Wired into the process monitor shutdown
 * hook so SQL tool connections don't outlive the server.
 */
export async function closeDatabaseToolPools(): Promise<void> {
  for (const [name, pool] of poolCache) {
    try {
      await pool.end();
      logger.info("sql tool pool closed", { connection: name });
    } catch (err) {
      logger.warn("sql tool pool close failed", { connection: name, error: (err as Error).message });
    }
  }
  poolCache.clear();
}

function getPoolForEntry(entry: ConnectionAllowlistEntry): pg.Pool {
  let pool = poolCache.get(entry.name);
  if (pool) return pool;

  const connectionString = process.env[entry.connectionEnv];
  if (!connectionString) {
    throw new Error(`Connection '${entry.name}' env var '${entry.connectionEnv}' is not set.`);
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 3,
    idleTimeoutMillis: 30_000,
    application_name: "abc-agent-sql-tool",
  });
  pool.on("error", (err) => logger.error("sql tool pool error", err, { connection: entry.name }));
  poolCache.set(entry.name, pool);
  return pool;
}

// ============================================================================
// ALLOWLIST
// ============================================================================

const ALLOWLIST: ConnectionAllowlistEntry[] = allowlist as ConnectionAllowlistEntry[];

/**
 * Validate the connection allowlist at startup. Each entry must reference an
 * env var that resolves to a parseable `postgresql://` URL with a public host.
 * Fails fast on misconfiguration.
 */
export function validateConnectionAllowlist(): void {
  for (const entry of ALLOWLIST) {
    if (!entry.name || !entry.connectionEnv || !Array.isArray(entry.ministries)) {
      throw new Error(`connectionAllowlist entry is malformed: ${JSON.stringify(entry)}`);
    }
    const value = process.env[entry.connectionEnv];
    if (!value) {
      logger.warn(`connectionAllowlist entry '${entry.name}' references unset env var '${entry.connectionEnv}'`);
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`connectionAllowlist '${entry.name}': env var '${entry.connectionEnv}' is not a valid URL.`);
    }
    if (!parsed.protocol.startsWith("postgres")) {
      throw new Error(`connectionAllowlist '${entry.name}': must be postgres:// URL, got '${parsed.protocol}'.`);
    }
    if (isPrivateOrReservedHost(parsed.hostname)) {
      logger.warn(`connectionAllowlist '${entry.name}' resolves to a private host '${parsed.hostname}' — acceptable for local dev only.`);
    }
  }
  logger.info("connectionAllowlist validated", { entries: ALLOWLIST.length });
}

function resolveAllowedConnection(
  connectionName: string,
  ministryCode: string | null
): { entry: ConnectionAllowlistEntry } | { error: string } {
  const entry = ALLOWLIST.find((e) => e.name === connectionName);
  if (!entry) {
    return { error: `Connection '${connectionName}' is not in the allowlist.` };
  }
  const wildcard = entry.ministries.includes("*");
  if (!wildcard) {
    if (!ministryCode) {
      return { error: `Connection '${connectionName}' requires a ministry-scoped caller.` };
    }
    if (!entry.ministries.includes(ministryCode)) {
      return { error: `Connection '${connectionName}' is not available to ministry '${ministryCode}'.` };
    }
  }
  return { entry };
}

// ============================================================================
// EXECUTE SQL
// ============================================================================

export async function executeSql(
  params: Record<string, unknown>,
  context?: ToolContext
): Promise<ExecuteSqlResult> {
  const connection = params.connection as string;
  const sql = (params.sql ?? params.query) as string;
  const sqlParams = (params.params as unknown[]) ?? [];
  const isWrite = params.isWrite === true;
  const requestedMax = (params.maxRows as number) ?? 1000;
  const maxRows = Math.min(Math.max(1, Math.floor(requestedMax)), MAX_ROWS_HARD_CAP);

  if (!connection || typeof connection !== "string") {
    return { success: false, error: "Parameter 'connection' is required." };
  }
  if (!sql || typeof sql !== "string") {
    return { success: false, error: "Parameter 'sql' is required." };
  }
  if (!Array.isArray(sqlParams)) {
    return { success: false, error: "Parameter 'params' must be an array if provided." };
  }
  // Sanity-check placeholders so the caller gets a clear error instead of a
  // pg "parameter $N does not exist" deep in the driver.
  const placeholders = (sql.match(/\$(\d+)/g) || []).map((m) => parseInt(m.slice(1), 10));
  if (placeholders.length > 0) {
    const maxPh = Math.max(...placeholders);
    if (maxPh > sqlParams.length) {
      return { success: false, error: `SQL references $${maxPh} but only ${sqlParams.length} params provided.` };
    }
  }

  const resolved = resolveAllowedConnection(connection, context?.ministryCode ?? null);
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { entry } = resolved;

  // Refuse writes against connections explicitly marked read-only.
  if (entry.readOnly === true && isWrite) {
    return { success: false, error: `Connection '${connection}' is marked read-only; writes are not permitted.` };
  }
  const effectiveReadOnly = entry.readOnly === true || !isWrite;

  let pool: pg.Pool;
  try {
    pool = getPoolForEntry(entry);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    if (effectiveReadOnly) {
      await client.query("SET TRANSACTION READ ONLY");
    }
    const result = await client.query(sql, sqlParams);
    await client.query("COMMIT");

    const truncated = result.rows.length > maxRows;
    const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

    return {
      success: true,
      rows,
      rowCount: result.rowCount ?? rows.length,
      fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      truncated,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback error */
    }
    logger.error("execute_sql failed", err, { connection, isWrite });
    return { success: false, error: `SQL error: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}

// ============================================================================
// READ DATABASE SCHEMAS
// ============================================================================

export async function readDatabaseSchemas(
  params: Record<string, unknown>,
  context?: ToolContext
): Promise<SchemasResult> {
  const connection = params.connection as string;
  const requestedSchemas = params.schemas as string[] | undefined;
  const requestedSchema = params.schema as string | undefined;

  if (!connection || typeof connection !== "string") {
    return { success: false, error: "Parameter 'connection' is required." };
  }

  const resolved = resolveAllowedConnection(connection, context?.ministryCode ?? null);
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { entry } = resolved;

  let pool: pg.Pool;
  try {
    pool = getPoolForEntry(entry);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query("SET TRANSACTION READ ONLY");

    const schemaList = requestedSchemas && requestedSchemas.length > 0
      ? requestedSchemas
      : requestedSchema
        ? [requestedSchema]
        : null;

    const result = schemaList
      ? await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
          `SELECT table_schema, table_name, column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = ANY($1::text[])
           ORDER BY table_schema, table_name, ordinal_position`,
          [schemaList]
        )
      : await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
          `SELECT table_schema, table_name, column_name, data_type
           FROM information_schema.columns
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY table_schema, table_name, ordinal_position`
        );

    await client.query("COMMIT");

    const grouped = new Map<string, Map<string, Array<{ name: string; type: string }>>>();
    for (const row of result.rows) {
      let schemaMap = grouped.get(row.table_schema);
      if (!schemaMap) {
        schemaMap = new Map();
        grouped.set(row.table_schema, schemaMap);
      }
      let cols = schemaMap.get(row.table_name);
      if (!cols) {
        cols = [];
        schemaMap.set(row.table_name, cols);
      }
      cols.push({ name: row.column_name, type: row.data_type });
    }

    const schemas = Array.from(grouped.entries()).map(([schema, tables]) => ({
      schema,
      tables: Array.from(tables.entries()).map(([name, columns]) => ({ name, columns })),
    }));

    return { success: true, schemas };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    logger.error("read_database_schemas failed", err, { connection });
    return { success: false, error: `Schema read failed: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}
