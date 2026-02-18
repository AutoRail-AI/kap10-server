/**
 * TemporalWorkflowEngine — IWorkflowEngine using Temporal.
 * Phase 0: connection + healthCheck only; no workflows started.
 *
 * @temporalio/client is required() inside getClient so the build never loads or connects to Temporal.
 * See Temporal docs: infra deps should be loaded at runtime only.
 */

import type { Client } from "@temporalio/client"
import type { WorkflowHandle, WorkflowStatus } from "@/lib/ports/types"
import type { IWorkflowEngine, TaskQueue } from "@/lib/ports/workflow-engine"

let clientInstance: Client | null = null

async function getClient(): Promise<Client> {
  if (!clientInstance) {
    const { Connection, Client: TemporalClient } = require("@temporalio/client") as typeof import("@temporalio/client")
    const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233"
    const connection = await Connection.connect({ address })
    clientInstance = new TemporalClient({ connection, namespace: "default" })
  }
  return clientInstance
}

export class TemporalWorkflowEngine implements IWorkflowEngine {
  async startWorkflow<T>(params: {
    workflowId: string
    workflowFn: string
    args: unknown[]
    taskQueue: TaskQueue
  }): Promise<WorkflowHandle<T>> {
    const client = await getClient()
    const handle = await client.workflow.start(params.workflowFn as never, {
      taskQueue: params.taskQueue,
      workflowId: params.workflowId,
      args: params.args as never,
    })
    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId ?? "",
      result: () => handle.result() as Promise<T>,
    }
  }

  async signalWorkflow(workflowId: string, signal: string, data?: unknown): Promise<void> {
    const client = await getClient()
    const handle = client.workflow.getHandle(workflowId)
    await handle.signal(signal as never, data)
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const client = await getClient()
    const handle = client.workflow.getHandle(workflowId)
    const desc = await handle.describe()
    const status = desc.status.name
    let progress: number | undefined
    try {
      if (status === "RUNNING" && typeof handle.query === "function") {
        progress = await handle.query("getProgress" as never)
      }
    } catch {
      // query not supported or workflow not ready
    }
    return { workflowId, status, progress }
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const client = await getClient()
    const handle = client.workflow.getHandle(workflowId)
    await handle.cancel()
  }

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    const start = Date.now()
    try {
      await getClient()
      return { status: "up", latencyMs: Date.now() - start }
    } catch {
      return { status: "down", latencyMs: Date.now() - start }
    }
  }
}
