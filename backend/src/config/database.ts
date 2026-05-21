/**
 * Database Configuration & Access Layer
 * 
 * PostgreSQL connection pool with:
 * - Automatic schema scoping (cohen_mcleod)
 * - Slow query detection and logging
 * - Transaction wrapper with automatic rollback
 * - Pool statistics export for health monitoring
 * - Graceful shutdown support
 */

import pg from "pg";
import { env } from "./env.js";
import { logger } from "../services/logger.js";

const { Pool } = pg;

// ============================================================================
// CONFIGURATION
// ============================================================================

const SLOW_QUERY_THRESHOLD_MS = 1000;
const POOL_CONFIG: pg.PoolConfig = {
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
};

// ============================================================================
// POOL MANAGEMENT
// ============================================================================

let pool: pg.Pool | null = null;
let queryCount = 0;
let slowQueryCount = 0;
let errorCount = 0;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      logger.warn("No DATABASE_URL configured. Database features will fail.");
      pool = new Pool({ connectionString: "postgresql://localhost:5432/abc", ...POOL_CONFIG });
    } else {
      pool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
        ...POOL_CONFIG,
      });
    }

    pool.on("error", (err) => {
      errorCount++;
      logger.error("Unexpected database pool error", err);
    });

    pool.on("connect", () => {
      logger.debug("New database client connected");
    });
  }
  return pool;
}

// ============================================================================
// QUERY EXECUTION
// ============================================================================

/**
 * Execute a query with automatic schema scoping and performance monitoring.
 */
export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const startTime = Date.now();
  const client = await getPool().connect();
  
  try {
    // Set search path to our schema for every query
    await client.query(`SET search_path TO ${env.DB_SCHEMA}, public`);
    const result = await client.query<T>(text, params);
    
    const durationMs = Date.now() - startTime;
    queryCount++;

    // Slow query detection
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      slowQueryCount++;
      logger.slowQuery(text, durationMs);
    } else {
      logger.query(text, durationMs, params);
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    errorCount++;
    logger.error("Database query failed", err as Error, {
      query: text.substring(0, 200),
      durationMs,
      paramCount: params?.length,
    });
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

/**
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 * 
 * Usage:
 * ```ts
 * const result = await transaction(async (tx) => {
 *   await tx.query("INSERT INTO ...", [...]);
 *   await tx.query("UPDATE ...", [...]);
 *   return { success: true };
 * });
 * ```
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  const startTime = Date.now();

  try {
    await client.query(`SET search_path TO ${env.DB_SCHEMA}, public`);
    await client.query("BEGIN");
    
    const result = await fn(client);
    
    await client.query("COMMIT");
    
    const durationMs = Date.now() - startTime;
    logger.debug("Transaction committed", { durationMs });
    
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    const durationMs = Date.now() - startTime;
    logger.error("Transaction rolled back", err as Error, { durationMs });
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// HEALTH & MONITORING
// ============================================================================

/**
 * Check database connectivity.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await query("SELECT 1 as ok");
    return result.rows[0]?.ok === 1;
  } catch (err) {
    logger.error("Database connection check failed", err as Error);
    return false;
  }
}

/**
 * Get pool statistics for health monitoring.
 */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  queryCount: number;
  slowQueryCount: number;
  errorCount: number;
} {
  const p = getPool();
  return {
    totalCount: p.totalCount,
    idleCount: p.idleCount,
    waitingCount: p.waitingCount,
    queryCount,
    slowQueryCount,
    errorCount,
  };
}

/**
 * Gracefully close the database pool.
 * Call during application shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    logger.info("Closing database pool...", getPoolStats());
    await pool.end();
    pool = null;
    logger.info("Database pool closed.");
  }
}
