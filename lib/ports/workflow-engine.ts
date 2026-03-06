import type { WorkflowHandle, WorkflowStatus } from "./types"

export type TaskQueue = "heavy-compute-queue" | "light-llm-queue"

export interface IWorkflowEngine {
  startWorkflow<T>(params: {
    workflowId: string
    workflowFn: string
    args: unknown[]
    taskQueue: TaskQueue
  }): Promise<WorkflowHandle<T>>

  signalWorkflow(workflowId: string, signal: string, data?: unknown): Promise<void>
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>
  cancelWorkflow(workflowId: string): Promise<void>

  /** Cancel ALL running workflows for a repo (uses Temporal visibility query). Returns count cancelled. */
  cancelAllRepoWorkflows(orgId: string, repoId: string): Promise<number>

  /** Health check: can we reach Temporal? */
  healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }>
}
