/**
 * Prompt drift detector — identifies when an AI agent is caught in a loop
 * by comparing recent prompts for semantic similarity.
 * Phase 5.5: P5.5-API-08
 */

export interface DriftDetectionResult {
  isDrifting: boolean
  similarity: number
  suggestion?: string
}

/**
 * Detect if the last N prompts show a repetition pattern.
 * Uses Jaccard similarity on tokenized prompts.
 */
export function detectPromptDrift(
  recentPrompts: string[],
  threshold = 0.7
): DriftDetectionResult {
  if (recentPrompts.length < 3) {
    return { isDrifting: false, similarity: 0 }
  }

  // Compare last prompt against previous ones using token overlap (Jaccard)
  const lastPrompt = recentPrompts[recentPrompts.length - 1]!
  const lastTokens = tokenize(lastPrompt)

  let maxSimilarity = 0
  let matchCount = 0

  for (let i = 0; i < recentPrompts.length - 1; i++) {
    const tokens = tokenize(recentPrompts[i]!)
    const sim = jaccardSimilarity(lastTokens, tokens)
    if (sim > threshold) matchCount++
    maxSimilarity = Math.max(maxSimilarity, sim)
  }

  // Drifting if 2+ previous prompts are similar to the latest
  const isDrifting = matchCount >= 2

  return {
    isDrifting,
    similarity: maxSimilarity,
    suggestion: isDrifting
      ? "The AI agent appears to be repeating similar prompts. Consider reverting to a working state or trying a different approach."
      : undefined,
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const token of Array.from(a)) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}
