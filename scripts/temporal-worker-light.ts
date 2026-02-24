#!/usr/bin/env tsx
/**
 * Temporal light-llm worker.
 * Registers all network-bound / LLM / DB-write activities on the light-llm-queue.
 *
 * Usage: pnpm temporal:worker:light
 * Connection retries with exponential backoff when Temporal server is not ready.
 */

// Load .env.local / .env before any imports that read process.env at module scope.
import "./load-env"

import { NativeConnection, Worker } from "@temporalio/worker"
import path from "node:path"
import * as indexingLight from "@/lib/temporal/activities/indexing-light"
import * as graphExport from "@/lib/temporal/activities/graph-export"
import * as graphUpload from "@/lib/temporal/activities/graph-upload"
import * as embedding from "@/lib/temporal/activities/embedding"
import * as justification from "@/lib/temporal/activities/justification"
import * as ontology from "@/lib/temporal/activities/ontology"
import * as healthReport from "@/lib/temporal/activities/health-report"
import * as driftAlert from "@/lib/temporal/activities/drift-alert"
import * as ledgerMerge from "@/lib/temporal/activities/ledger-merge"
import * as adrGeneration from "@/lib/temporal/activities/adr-generation"
import * as ruleDecay from "@/lib/temporal/activities/rule-decay"
import * as workspaceCleanup from "@/lib/temporal/activities/workspace-cleanup"
import * as onboarding from "@/lib/temporal/activities/onboarding"
import * as antiPattern from "@/lib/temporal/activities/anti-pattern"
import * as review from "@/lib/temporal/activities/review"
import * as incremental from "@/lib/temporal/activities/incremental"
import * as patternDetection from "@/lib/temporal/activities/pattern-detection"
import * as pipelineLogs from "@/lib/temporal/activities/pipeline-logs"

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233"
const TASK_QUEUE = "light-llm-queue"
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
          // Phase 1: Indexing (light)
          ...indexingLight,
          // Phase 3: Embedding
          ...embedding,
          // Phase 4: Ontology & Justification
          ...ontology,
          ...justification,
          // Phase 4: Health reports
          ...healthReport,
          // Phase 5: Incremental indexing (light activities)
          ...incremental,
          // Phase 5: Drift detection
          ...driftAlert,
          // Phase 6: Pattern detection (light: llmSynthesizeRules, storePatterns)
          ...patternDetection,
          // Phase 6: Rule decay
          ...ruleDecay,
          // Phase 6: Anti-pattern
          ...antiPattern,
          // PR review (light: fetchDiff, runChecks, postReview, checkAndPostNudge)
          ...review,
          // Ledger merge
          ...ledgerMerge,
          // ADR generation
          ...adrGeneration,
          // Phase 10a: Graph snapshot activities
          ...graphExport,
          ...graphUpload,
          // Workspace cleanup
          ...workspaceCleanup,
          // Onboarding
          ...onboarding,
          // Pipeline logging
          ...pipelineLogs,
        },
      })
      return worker
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (backoff >= MAX_RETRY_MS) {
        console.error("[temporal-worker-light] Max retries reached:", message)
        throw error
      }
      console.warn(
        `[temporal-worker-light] Connection attempt ${attempt} failed (${message}). Retrying in ${backoff}ms...`
      )
      await sleep(backoff)
      backoff = Math.min(backoff * 2, MAX_RETRY_MS)
    }
  }
}

function logMemory(): void {
  const mem = process.memoryUsage()
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`
  console.log(
    `[memory] heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)}, rss: ${mb(mem.rss)}, external: ${mb(mem.external)}, arrayBuffers: ${mb(mem.arrayBuffers)}`
  )
}

async function main(): Promise<void> {
  const worker = await createWorkerWithRetry()
  console.log(`Light LLM worker started, task queue: ${TASK_QUEUE}. Waiting for tasks...`)

  // Log memory every 30s to track for OOM debugging
  const memInterval = setInterval(logMemory, 30_000)
  logMemory()

  try {
    await worker.run()
  } finally {
    clearInterval(memInterval)
  }
}

main().catch((err: unknown) => {
  console.error("Worker failed:", err)
  process.exit(1)
})
