export interface CostBreakdown {
  byModel: Record<string, number>
  total: number
  [key: string]: unknown
}

export interface ModelUsageEntry {
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  [key: string]: unknown
}

export interface IObservability {
  getOrgLLMCost(orgId: string, from: Date, to: Date): Promise<number>
  getCostBreakdown(orgId: string, from: Date, to: Date): Promise<CostBreakdown>
  getModelUsage(orgId: string, from: Date, to: Date): Promise<ModelUsageEntry[]>
  /** Health: can we reach Langfuse? Returns "up" | "down" | "unconfigured" */
  healthCheck(): Promise<{ status: "up" | "down" | "unconfigured"; latencyMs?: number }>
}
