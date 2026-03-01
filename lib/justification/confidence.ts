/**
 * Calibrated confidence model — replaces raw LLM self-reported confidence
 * with a composite score derived from observable signals.
 *
 * Three dimensions:
 *   structural (0-0.5): graph position — callers, callees, PageRank
 *   intent     (0-0.3): documentation, tests, naming quality
 *   llm        (0-0.2): LLM output weighted by model tier
 */

export interface ConfidenceSignals {
  hasCallers: boolean
  hasCallees: boolean
  hasTests: boolean
  hasDocs: boolean
  hasDescriptiveName: boolean
  llmConfidence: number
  llmModelTier: "heuristic" | "fast" | "standard" | "premium"
  pageRankPercentile?: number // 0-100
}

export interface CalibratedConfidence {
  composite: number // 0-1
  breakdown: {
    structural: number // 0-0.5
    intent: number     // 0-0.3
    llm: number        // 0-0.2
  }
}

/** Names too generic to provide meaningful signal */
const NON_DESCRIPTIVE_NAMES = new Set([
  "handle", "handler", "process", "do", "run", "get", "set",
  "data", "info", "temp", "tmp", "foo", "bar", "baz", "test",
  "main", "init", "setup", "execute", "call", "invoke", "apply",
  "cb", "fn", "func", "val", "obj", "res", "req", "err",
])

export function isDescriptiveName(name: string): boolean {
  if (name.length <= 3) return false
  // Strip common prefixes/suffixes and check
  const base = name
    .replace(/^(get|set|is|has|on|_)/, "")
    .replace(/(Handler|Callback|Fn|Impl)$/, "")
    .toLowerCase()
  return !NON_DESCRIPTIVE_NAMES.has(base) && !NON_DESCRIPTIVE_NAMES.has(name.toLowerCase())
}

const TIER_WEIGHTS: Record<ConfidenceSignals["llmModelTier"], number> = {
  heuristic: 0.15,
  fast: 0.15,
  standard: 0.18,
  premium: 0.20,
}

export function computeCalibratedConfidence(
  signals: ConfidenceSignals
): CalibratedConfidence {
  // Structural dimension (0-0.5)
  let structural = 0
  if (signals.hasCallers) structural += 0.25
  if (signals.hasCallees) structural += 0.15
  if ((signals.pageRankPercentile ?? 0) > 50) structural += 0.10

  // Intent dimension (0-0.3)
  let intent = 0
  if (signals.hasDocs) intent += 0.15
  if (signals.hasTests) intent += 0.10
  if (signals.hasDescriptiveName) intent += 0.05

  // LLM dimension (0-0.2)
  const tierWeight = TIER_WEIGHTS[signals.llmModelTier]
  const llm = Math.min(signals.llmConfidence, 1) * tierWeight

  const composite = Math.min(structural + intent + llm, 1)

  return {
    composite,
    breakdown: {
      structural,
      intent,
      llm: Math.round(llm * 1000) / 1000, // avoid floating point noise
    },
  }
}
