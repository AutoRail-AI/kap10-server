/**
 * Phase 4: Drift Detector — detects semantic drift between code changes
 * by comparing AST hashes and embedding similarity.
 *
 * Categories:
 * - stable:       AST same, embeddings same
 * - cosmetic:     AST changed, embeddings very similar (>0.95)
 * - refactor:     AST changed, embeddings similar (0.8-0.95)
 * - intent_drift: AST changed, embeddings divergent (<0.8)
 */

import type { DriftCategory } from "./schemas"

export interface DriftInput {
  astHashOld: string
  astHashNew: string
  embeddingOld: number[]
  embeddingNew: number[]
}

export interface DriftResult {
  category: DriftCategory
  embeddingSimilarity: number
}

/**
 * Compute drift between old and new versions of an entity.
 */
export function computeDrift(input: DriftInput): DriftResult {
  // If AST hash hasn't changed, entity is stable
  if (input.astHashOld === input.astHashNew) {
    return { category: "stable", embeddingSimilarity: 1.0 }
  }

  // AST changed — check embedding similarity
  const similarity = cosineSimilarity(input.embeddingOld, input.embeddingNew)

  if (similarity > 0.95) {
    return { category: "cosmetic", embeddingSimilarity: similarity }
  }

  if (similarity > 0.8) {
    return { category: "refactor", embeddingSimilarity: similarity }
  }

  return { category: "intent_drift", embeddingSimilarity: similarity }
}

/**
 * Cosine similarity between two vectors.
 * Returns 0 for empty/mismatched vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}
