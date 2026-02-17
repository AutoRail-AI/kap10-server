/**
 * TemporalWorkflowEngine — IWorkflowEngine using Temporal.
 * Phase 0: connection + healthCheck only; no workflows started.
 */

import { Client, Connection } from "@temporalio/client"
import type { WorkflowHandle, WorkflowStatus } from "@/lib/ports/types"
import type { IWorkflowEngine, TaskQueue } from "@/lib/ports/workflow-engine"

let clientInstance: Client | null = null

async function getClient(): Promise<Client> {
  if (!clientInstance) {
    const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233"
    const connection = await Connection.connect({ address })
    clientInstance = new Client({ connection, namespace: "default" })
  }
  return clientInstance
}

export class TemporalWorkflowEngine implements IWorkflowEngine {
  async startWorkflow<T>(_params: {
    workflowId: string
    workflowFn: string
    args: unknown[]
    taskQueue: TaskQueue
  }): Promise<WorkflowHandle<T>> {
    throw new Error("Phase 0: no workflows started yet")
  }

  async signalWorkflow(_workflowId: string, _signal: string, _data?: unknown): Promise<void> {
    throw new Error("Phase 0: not implemented")
  }

  async getWorkflowStatus(_workflowId: string): Promise<WorkflowStatus> {
    throw new Error("Phase 0: not implemented")
  }

  async cancelWorkflow(_workflowId: string): Promise<void> {
    throw new Error("Phase 0: not implemented")
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
