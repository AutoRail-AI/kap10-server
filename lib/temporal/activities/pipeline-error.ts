/**
 * Structured pipeline error classification.
 *
 * Every pipeline activity should classify errors before re-throwing so that:
 * 1. Temporal retry policies can act on error kind (retryable vs fatal)
 * 2. The pipeline run UI shows meaningful error categories
 * 3. The resume route knows which step to restart from
 *
 * Error classification hierarchy:
 * - RETRYABLE_NETWORK: LLM timeouts, API 429s, DNS failures → Temporal retries handle these
 * - RETRYABLE_RESOURCE: Redis unavailable, disk full, OOM → may need backoff or manual intervention
 * - FATAL_DATA: Missing repo, corrupt graph, schema mismatch → requires human fix
 * - FATAL_CONFIG: Missing env vars, bad credentials → deploy/config fix needed
 */

import { ApplicationFailure } from "@temporalio/activity"

export enum PipelineErrorKind {
  RETRYABLE_NETWORK = "retryable_network",
  RETRYABLE_RESOURCE = "retryable_resource",
  FATAL_DATA = "fatal_data",
  FATAL_CONFIG = "fatal_config",
}

export interface ClassifiedError {
  kind: PipelineErrorKind
  step: string
  message: string
  retryable: boolean
  originalMessage: string
}

/**
 * Pattern-based error classifier. Inspects error messages to determine
 * the error kind. Used by pipeline activities to wrap raw errors.
 *
 * IMPORTANT: This does NOT swallow errors. It classifies and re-throws
 * as Temporal ApplicationFailure with the appropriate non-retryable flag.
 */
export function classifyPipelineError(error: unknown, step: string): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMsg = message.toLowerCase()

  // Network/LLM retryable patterns
  const networkPatterns = [
    "econnrefused", "econnreset", "etimedout", "enotfound",
    "socket hang up", "fetch failed", "network error",
    "429", "rate limit", "too many requests",
    "503", "service unavailable", "502", "bad gateway",
    "timeout", "timed out", "deadline exceeded",
    "vertex ai", "openai", "anthropic",  // LLM provider errors are usually transient
  ]
  if (networkPatterns.some((p) => lowerMsg.includes(p))) {
    return {
      kind: PipelineErrorKind.RETRYABLE_NETWORK,
      step,
      message: `[${step}] Network/LLM error (retryable): ${message}`,
      retryable: true,
      originalMessage: message,
    }
  }

  // Resource exhaustion patterns
  const resourcePatterns = [
    "redis", "enospc", "no space left", "out of memory", "oom",
    "connection pool", "too many connections", "max_connections",
    "disk quota", "enomem",
  ]
  if (resourcePatterns.some((p) => lowerMsg.includes(p))) {
    return {
      kind: PipelineErrorKind.RETRYABLE_RESOURCE,
      step,
      message: `[${step}] Resource error (retryable with backoff): ${message}`,
      retryable: true,
      originalMessage: message,
    }
  }

  // Config/credential errors are fatal — no point retrying
  const configPatterns = [
    "missing env", "environment variable", "not configured",
    "invalid credentials", "unauthorized", "forbidden", "401", "403",
    "invalid api key", "api key", "token expired",
  ]
  if (configPatterns.some((p) => lowerMsg.includes(p))) {
    return {
      kind: PipelineErrorKind.FATAL_CONFIG,
      step,
      message: `[${step}] Configuration error (non-retryable): ${message}`,
      retryable: false,
      originalMessage: message,
    }
  }

  // Everything else is treated as a data/logic error — fatal by default
  // but Temporal's default retry policy will still attempt retries unless
  // we explicitly mark it non-retryable via ApplicationFailure.
  return {
    kind: PipelineErrorKind.FATAL_DATA,
    step,
    message: `[${step}] Data/logic error: ${message}`,
    retryable: false,
    originalMessage: message,
  }
}

/**
 * Classify an error and throw it as a Temporal ApplicationFailure.
 * Non-retryable errors get `nonRetryable: true` so Temporal doesn't waste retries.
 *
 * Usage in activities:
 * ```ts
 * try {
 *   await doWork()
 * } catch (err) {
 *   throwClassifiedError(err, "Step 2/7: SCIP")
 * }
 * ```
 */
export function throwClassifiedError(error: unknown, step: string): never {
  const classified = classifyPipelineError(error, step)

  throw ApplicationFailure.create({
    message: classified.message,
    type: classified.kind,
    nonRetryable: !classified.retryable,
    details: [classified],
  })
}
