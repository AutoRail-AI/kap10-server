#!/usr/bin/env tsx
/**
 * Register Temporal schedules — Phase 13 (A-18).
 *
 * Creates or updates durable cron schedules on the Temporal server.
 * Idempotent: safe to re-run on every deploy.
 *
 * Usage: pnpm temporal:schedules
 *
 * Schedules registered:
 *   - evict-artifacts-schedule: daily at 3 AM UTC, runs evictArtifactsWorkflow
 */

import "./load-env"

import { Connection, Client } from "@temporalio/client"

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233"

interface ScheduleSpec {
  scheduleId: string
  workflowType: string
  taskQueue: string
  cronExpression: string
  args: unknown[]
  memo?: Record<string, string>
}

const SCHEDULES: ScheduleSpec[] = [
  {
    scheduleId: "evict-artifacts-schedule",
    workflowType: "evictArtifactsWorkflow",
    taskQueue: "light-llm-queue",
    // Daily at 3 AM UTC — low-traffic window for eviction
    cronExpression: "0 3 * * *",
    args: [{}], // empty EvictArtifactsInput = use defaults
    memo: { description: "Phase 13: Daily eviction of stale SCIP artifacts, branch refs, and workspaces" },
  },
]

async function main(): Promise<void> {
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}...`)
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS })
  const client = new Client({ connection, namespace: "default" })
  const scheduleClient = client.schedule

  for (const spec of SCHEDULES) {
    try {
      // Try to get existing schedule — if it exists, update it
      const existing = scheduleClient.getHandle(spec.scheduleId)
      try {
        await existing.describe()
        // Schedule exists — update it (callback receives ScheduleDescription, returns ScheduleUpdateOptions)
        await existing.update(() => ({
          spec: {
            cronExpressions: [spec.cronExpression],
          },
          action: {
            type: "startWorkflow" as const,
            workflowType: spec.workflowType,
            taskQueue: spec.taskQueue,
            args: spec.args,
          },
          state: {
            note: spec.memo?.description ?? "",
          },
        }))
        console.log(`  Updated schedule: ${spec.scheduleId} (cron: ${spec.cronExpression})`)
      } catch {
        // Schedule doesn't exist — create it
        await scheduleClient.create({
          scheduleId: spec.scheduleId,
          spec: {
            cronExpressions: [spec.cronExpression],
          },
          action: {
            type: "startWorkflow" as const,
            workflowType: spec.workflowType,
            taskQueue: spec.taskQueue,
            args: spec.args,
          },
          state: {
            note: spec.memo?.description ?? "",
          },
        })
        console.log(`  Created schedule: ${spec.scheduleId} (cron: ${spec.cronExpression})`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  Failed to register schedule ${spec.scheduleId}: ${msg}`)
      process.exit(1)
    }
  }

  console.log(`\nAll ${SCHEDULES.length} schedule(s) registered successfully.`)
}

main().catch((err: unknown) => {
  console.error("Schedule registration failed:", err)
  process.exit(1)
})
