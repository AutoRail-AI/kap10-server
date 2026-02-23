/**
 * Pipeline log activities — captures user-facing pipeline logs to Redis
 * and archives them to Supabase Storage when the pipeline completes.
 *
 * Three exports:
 *   - appendPipelineLog: Temporal activity for workflows (fire-and-forget)
 *   - createPipelineLogger: Helper for activities (not sandboxed)
 *   - archivePipelineLogs: Activity that archives logs to Supabase Storage
 */

import { getRedis } from "@/lib/queue/redis"
import { logger } from "@/lib/utils/logger"

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineLogEntry {
  timestamp: string // ISO 8601
  level: "info" | "warn" | "error"
  phase:
    | "indexing"
    | "embedding"
    | "ontology"
    | "justifying"
    | "graph-sync"
    | "pattern-detection"
  step: string
  message: string
  meta?: Record<string, unknown>
}

const REDIS_KEY_PREFIX = "kap10:pipeline-logs:"
const TTL_LIVE = 24 * 60 * 60 // 24 hours
const TTL_AFTER_ARCHIVE = 60 * 60 // 1 hour

// ── appendPipelineLog (Temporal activity) ────────────────────────────────────

/**
 * Activity callable from workflows via proxyActivities.
 * Pushes a log entry to the Redis list for this repo.
 */
export async function appendPipelineLog(entry: PipelineLogEntry): Promise<void> {
  try {
    const redis = getRedis()
    const key = `${REDIS_KEY_PREFIX}${entry.meta?.["repoId"] ?? "unknown"}`
    await redis.rpush(key, JSON.stringify(entry))
    await redis.expire(key, TTL_LIVE)
  } catch {
    // Best-effort — logging must never fail the pipeline
  }
}

// ── createPipelineLogger (helper for activities) ─────────────────────────────

/**
 * Creates a pipeline logger for use inside activities (not sandboxed).
 * Returns a `log` function that RPUSH entries to Redis. Best-effort.
 */
export function createPipelineLogger(repoId: string, phase: PipelineLogEntry["phase"]) {
  return {
    log(
      level: PipelineLogEntry["level"],
      step: string,
      message: string,
      meta?: Record<string, unknown>
    ): void {
      const entry: PipelineLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        phase,
        step,
        message,
        meta: { ...meta, repoId },
      }
      try {
        const redis = getRedis()
        const key = `${REDIS_KEY_PREFIX}${repoId}`
        redis
          .rpush(key, JSON.stringify(entry))
          .then(() => redis.expire(key, TTL_LIVE))
          .catch(() => {
            // swallow
          })
      } catch {
        // swallow
      }
    },
  }
}

// ── archivePipelineLogs (Temporal activity) ──────────────────────────────────

export interface ArchivePipelineLogsInput {
  orgId: string
  repoId: string
}

/**
 * Activity that reads all log entries from Redis, uploads to Supabase Storage
 * as both .log (plain text) and .json (structured), then shortens Redis TTL.
 */
export async function archivePipelineLogs(input: ArchivePipelineLogsInput): Promise<void> {
  const log = logger.child({
    service: "pipeline-logs",
    organizationId: input.orgId,
    repoId: input.repoId,
  })

  try {
    const redis = getRedis()
    const key = `${REDIS_KEY_PREFIX}${input.repoId}`
    const raw = await redis.lrange(key, 0, -1)

    if (raw.length === 0) {
      log.info("No pipeline logs to archive")
      return
    }

    const entries: PipelineLogEntry[] = raw.map((r) => JSON.parse(r) as PipelineLogEntry)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

    // Build plain text log
    const textLines = entries.map(
      (e) =>
        `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.phase}] ${e.step ? `${e.step} — ` : ""}${e.message}`
    )
    const textContent = textLines.join("\n")

    // Build JSON archive
    const jsonContent = JSON.stringify(entries, null, 2)

    // Upload to Supabase Storage
    const { supabase } = require("@/lib/db") as typeof import("@/lib/db")
    const basePath = `${input.orgId}/${input.repoId}/${timestamp}`

    const { error: textError } = await supabase.storage
      .from("pipeline-logs")
      .upload(`${basePath}.log`, textContent, {
        contentType: "text/plain",
        upsert: true,
      })

    if (textError) {
      log.warn("Failed to upload .log archive", { error: textError.message })
    }

    const { error: jsonError } = await supabase.storage
      .from("pipeline-logs")
      .upload(`${basePath}.json`, jsonContent, {
        contentType: "application/json",
        upsert: true,
      })

    if (jsonError) {
      log.warn("Failed to upload .json archive", { error: jsonError.message })
    }

    // Shorten Redis TTL so logs stick around briefly for UI transition
    await redis.expire(key, TTL_AFTER_ARCHIVE)
    log.info("Pipeline logs archived", { entryCount: entries.length, path: basePath })
  } catch (error: unknown) {
    log.warn("Failed to archive pipeline logs", {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    // Best-effort — don't throw
  }
}
