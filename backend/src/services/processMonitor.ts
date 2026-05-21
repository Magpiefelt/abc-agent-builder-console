/**
 * Process Error Monitor
 *
 * Catches unhandled promise rejections and uncaught exceptions to prevent
 * silent failures during long-running agent orchestrations.
 *
 * Adapted from the Hockey App's `server/plugins/process-errors.ts` pattern.
 *
 * Behavior:
 * - Unhandled rejections: Logged but process stays alive (fire-and-forget patterns
 *   like audit logging and email should not crash the server).
 * - Uncaught exceptions: Logged, then process exits in production so the
 *   orchestrator/supervisor can restart it.
 * - Graceful shutdown: Handles SIGTERM/SIGINT for clean connection pool closure.
 */

import { logger } from "./logger.js";

let installed = false;

/**
 * Install global process error handlers.
 * Safe to call multiple times — only installs once.
 */
export function installProcessMonitor(onShutdown?: () => Promise<void>): void {
  if (installed) return;
  installed = true;

  // ============================================================================
  // UNHANDLED PROMISE REJECTIONS
  // ============================================================================

  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("Unhandled promise rejection", err, {
      type: "unhandledRejection",
    });
  });

  // ============================================================================
  // UNCAUGHT EXCEPTIONS
  // ============================================================================

  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception — process may be in an inconsistent state", error, {
      type: "uncaughtException",
    });

    if (process.env.NODE_ENV === "production") {
      // Give the logger a moment to flush, then exit so the supervisor restarts us.
      logger.info("Initiating graceful shutdown after uncaught exception");
      setTimeout(() => process.exit(1), 500).unref();
    }
  });

  // ============================================================================
  // GRACEFUL SHUTDOWN (SIGTERM / SIGINT)
  // ============================================================================

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      if (onShutdown) {
        await onShutdown();
      }
      logger.info("Graceful shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error("Error during graceful shutdown", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("Process monitor installed", {
    handlers: ["unhandledRejection", "uncaughtException", "SIGTERM", "SIGINT"],
  });
}
