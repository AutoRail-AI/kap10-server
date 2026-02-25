type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogContext {
  userId?: string
  organizationId?: string
  repoId?: string
  workflowId?: string
  activityType?: string
  service?: string
  requestId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Standardized logger for the entire Unerr application.
 *
 * Log format:
 *   [UTC timestamp] [LEVEL] [service] [orgId/repoId] message {extra}
 *
 * Examples:
 *   [2026-02-22T14:19:30.072Z] [INFO] [embedding] [org_abc/repo_123] Starting embedding generation {documentCount: 42}
 *   [2026-02-22T14:19:31.601Z] [ERROR] [embedding] [org_abc/repo_123] Embedding failed {errorMessage: "sharp module not found"}
 *   [2026-02-22T14:19:32.000Z] [WARN] [api] [-/-] Retry rate-limited {userId: "user_xyz"}
 *
 * Usage:
 *   logger.info("Starting indexing", { organizationId, repoId })
 *
 *   // Create a child logger pre-bound with context:
 *   const log = logger.child({ service: "embedding", organizationId, repoId })
 *   log.info("Step 1 complete")
 *   log.error("Step 2 failed", err)
 */
class Logger {
  private baseContext: LogContext

  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext
  }

  /**
   * Create a child logger with pre-bound context fields.
   * All log calls on the child will include these fields automatically.
   */
  child(context: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...context })
  }

  private formatLine(level: LogLevel, message: string, context?: LogContext): string {
    const merged = { ...this.baseContext, ...context }
    const ts = new Date().toISOString()
    const lvl = level.toUpperCase().padEnd(5)
    const svc = merged.service ?? "-"
    const orgId = merged.organizationId ?? "-"
    const repoId = merged.repoId ?? "-"

    // Build extra data string from remaining fields (exclude known fields)
    const knownKeys = new Set(["service", "organizationId", "repoId", "userId", "workflowId", "activityType", "requestId"])
    const extra: Record<string, unknown> = {}
    // Always include identity fields if present
    if (merged.userId) extra.userId = merged.userId
    if (merged.workflowId) extra.workflowId = merged.workflowId
    if (merged.activityType) extra.activityType = merged.activityType
    if (merged.requestId) extra.requestId = merged.requestId
    for (const [k, v] of Object.entries(merged)) {
      if (!knownKeys.has(k) && v !== undefined) {
        extra[k] = v
      }
    }
    const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""

    return `[${ts}] [${lvl}] [${svc}] [${orgId}/${repoId}] ${message}${extraStr}`
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const line = this.formatLine(level, message, context)

    switch (level) {
      case "debug":
        if (process.env.NODE_ENV === "development") {
          console.debug(line)
        }
        break
      case "info":
        console.info(line)
        break
      case "warn":
        console.warn(line)
        break
      case "error":
        console.error(line)
        break
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context)
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorFields: LogContext = {}
    if (error instanceof Error) {
      errorFields.errorName = error.name
      errorFields.errorMessage = error.message
      errorFields.errorStack = error.stack
    } else if (error !== undefined) {
      errorFields.errorMessage = String(error)
    }
    this.log("error", message, { ...context, ...errorFields })
  }
}

export const logger = new Logger()
