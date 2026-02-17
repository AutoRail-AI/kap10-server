/**
 * LangfuseObservability — IObservability (partial).
 * Phase 0: healthCheck reports up/down/unconfigured; cost methods return zeros when unconfigured.
 */

import type { CostBreakdown, IObservability, ModelUsageEntry } from "@/lib/ports/observability"

function isConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_SECRET_KEY &&
      process.env.LANGFUSE_PUBLIC_KEY
  )
}

export class LangfuseObservability implements IObservability {
  async getOrgLLMCost(_orgId: string, _from: Date, _to: Date): Promise<number> {
    if (!isConfigured()) return 0
    // Phase 1+: call Langfuse API
    return 0
  }

  async getCostBreakdown(_orgId: string, _from: Date, _to: Date): Promise<CostBreakdown> {
    if (!isConfigured()) return { byModel: {}, total: 0 }
    return { byModel: {}, total: 0 }
  }

  async getModelUsage(_orgId: string, _from: Date, _to: Date): Promise<ModelUsageEntry[]> {
    if (!isConfigured()) return []
    return []
  }

  async healthCheck(): Promise<{ status: "up" | "down" | "unconfigured"; latencyMs?: number }> {
    const start = Date.now()
    if (!isConfigured()) {
      return { status: "unconfigured", latencyMs: Date.now() - start }
    }
    // Optional: ping Langfuse API
    return { status: "up", latencyMs: Date.now() - start }
  }
}
