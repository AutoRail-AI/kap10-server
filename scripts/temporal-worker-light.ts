#!/usr/bin/env tsx
/**
 * Temporal light-llm worker (Phase 0: registers queue, no activities yet).
 * Phase 1+ will add writeToArango, justifyEntity, etc.
 *
 * Usage: pnpm temporal:worker:light
 * Connection retries with exponential backoff when Temporal server is not ready.
 */

import { NativeConnection, Worker } from "@temporalio/worker"
import path from "node:path"
import * as indexingLight from "@/lib/temporal/activities/indexing-light"
import * as graphExport from "@/lib/temporal/activities/graph-export"
import * as graphUpload from "@/lib/temporal/activities/graph-upload"

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
          writeToArango: indexingLight.writeToArango,
          updateRepoError: indexingLight.updateRepoError,
          deleteRepoData: indexingLight.deleteRepoData,
          // Phase 10a: Graph snapshot activities
          queryCompactGraph: graphExport.queryCompactGraph,
          serializeToMsgpack: graphExport.serializeToMsgpack,
          uploadToStorage: graphUpload.uploadToStorage,
          updateSnapshotStatus: graphUpload.updateSnapshotStatus,
          notifyConnectedClients: graphUpload.notifyConnectedClients,
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

async function main(): Promise<void> {
  const worker = await createWorkerWithRetry()
  console.log(`Light LLM worker started, task queue: ${TASK_QUEUE}. Waiting for tasks...`)
  await worker.run()
}

main().catch((err: unknown) => {
  console.error("Worker failed:", err)
  process.exit(1)
})
