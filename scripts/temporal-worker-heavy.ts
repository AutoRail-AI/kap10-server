#!/usr/bin/env tsx
/**
 * Temporal heavy-compute worker.
 * Registers all CPU-bound activities on the heavy-compute-queue.
 *
 * Usage: pnpm temporal:worker:heavy
 * Connection retries with exponential backoff when Temporal server is not ready.
 */

// Load .env.local / .env before any imports that read process.env at module scope.
import "./load-env"

import { NativeConnection, Worker } from "@temporalio/worker"
import path from "node:path"
import * as incremental from "@/lib/temporal/activities/incremental"
import * as indexingHeavy from "@/lib/temporal/activities/indexing-heavy"
import * as patternDetection from "@/lib/temporal/activities/pattern-detection"
import * as patternMining from "@/lib/temporal/activities/pattern-mining"
import * as review from "@/lib/temporal/activities/review"
import * as ruleSimulation from "@/lib/temporal/activities/rule-simulation"
import * as workspaceCleanup from "@/lib/temporal/activities/workspace-cleanup"

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233"
const TASK_QUEUE = "heavy-compute-queue"
const MAX_RETRY_MS = 60_000
const INITIAL_BACKOFF_MS = 1_000

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createWorkerWithRetry(): Promise<Worker> {
  let backoff = INITIAL_BACKOFF_MS
  let attempt = 0

  while (true) {
    attempt++
    try {
      const connection = await NativeConnection.connect({
        address: TEMPORAL_ADDRESS,
      })
      const worker = await Worker.create({
        workflowsPath: path.resolve(process.cwd(), "lib/temporal/workflows"),
        taskQueue: TASK_QUEUE,
        connection,
        activities: {
          // Phase 1: Indexing (heavy)
          ...indexingHeavy,
          // Phase 5: Incremental indexing (heavy: pullAndDiff, reIndexBatch)
          ...incremental,
          // Phase 6: Pattern detection (heavy: astGrepScan)
          ...patternDetection,
          // Phase 6: Pattern mining (heavy)
          ...patternMining,
          // Phase 6: Rule simulation (heavy)
          ...ruleSimulation,
          // PR review (heavy: runChecksHeavy)
          ...review,
          // Workspace cleanup (K-01)
          ...workspaceCleanup,
        },
      })
      return worker
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (backoff >= MAX_RETRY_MS) {
        console.error("[temporal-worker-heavy] Max retries reached:", message)
        throw error
      }
      console.warn(
        `[temporal-worker-heavy] Connection attempt ${attempt} failed (${message}). Retrying in ${backoff}ms...`
      )
      await sleep(backoff)
      backoff = Math.min(backoff * 2, MAX_RETRY_MS)
    }
  }
}

async function main(): Promise<void> {
  const worker = await createWorkerWithRetry()
  console.log(`Heavy compute worker started, task queue: ${TASK_QUEUE}. Waiting for tasks...`)
  await worker.run()
}

main().catch((err: unknown) => {
  console.error("Worker failed:", err)
  process.exit(1)
})
