/**
 * L-09: Change-type classification for semantic staleness cascading.
 *
 * Classifies WHAT changed between old and new entity versions,
 * then applies per-type cascade rules:
 *
 * | Change Type              | Cascade? | Rationale                        |
 * |--------------------------|----------|----------------------------------|
 * | Signature changed        | Always   | Contract change                  |
 * | Semantic anchors changed | Always   | Business logic changed           |
 * | Body changed, same anchors| Cosine  | Internal refactor — check meaning|
 * | Comments/whitespace only | Never    | No semantic change               |
 * | Test assertions changed  | Always   | Intent changed                   |
 */

import type { EntityDoc } from "@/lib/ports/types"

// ── Change Types ───────────────────────────────────────────────────────────────

export type ChangeType =
  | "signature_changed"
  | "anchors_changed"
  | "body_refactor"
  | "comments_only"
  | "test_assertions"
  | "no_change"

export interface ChangeClassification {
  changeType: ChangeType
  shouldCascade: boolean
  reason: string
}

// ── Semantic Anchor Patterns ───────────────────────────────────────────────────

/** Patterns that identify semantic anchors in code — business decisions, mutations, errors */
const ANCHOR_PATTERNS = [
  /\bif\s*\(/g,
  /\bswitch\s*\(/g,
  /\bthrow\s+/g,
  /\breturn\s+/g,
  /\bawait\s+/g,
  /\byield\s+/g,
  /\.emit\s*\(/g,
  /\.dispatch\s*\(/g,
  /\.save\s*\(/g,
  /\.update\s*\(/g,
  /\.delete\s*\(/g,
  /\.insert\s*\(/g,
  /\.create\s*\(/g,
  /\.remove\s*\(/g,
  /\.push\s*\(/g,
  /\.set\s*\(/g,
]

/** Test assertion patterns */
const TEST_ASSERTION_PATTERNS = [
  /\bexpect\s*\(/g,
  /\bassert\s*[.(]/g,
  /\.toBe\s*\(/g,
  /\.toEqual\s*\(/g,
  /\.toThrow\s*\(/g,
  /\.toContain\s*\(/g,
  /\.toHaveBeenCalled/g,
  /\.should\./g,
]

// ── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Extract semantic anchors from code body.
 * Returns a sorted, deduplicated array of anchor strings for comparison.
 */
function extractAnchors(body: string): string[] {
  const anchors: string[] = []
  for (const pattern of ANCHOR_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null = null
    while ((match = regex.exec(body)) !== null) {
      anchors.push(match[0].trim())
    }
  }
  return anchors.sort()
}

/**
 * Extract test assertions from code body.
 */
function extractTestAssertions(body: string): string[] {
  const assertions: string[] = []
  for (const pattern of TEST_ASSERTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null = null
    while ((match = regex.exec(body)) !== null) {
      assertions.push(match[0].trim())
    }
  }
  return assertions
}

/**
 * Strip comments and whitespace from code for comparison.
 * Handles single-line (//) and multi-line comments, plus JSDoc.
 */
function stripCommentsAndWhitespace(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, "")          // line comments
    .replace(/#.*$/gm, "")             // Python-style comments
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim()
}

/**
 * Check if a file path looks like a test file.
 */
function isTestFile(filePath: string): boolean {
  return /\.(test|spec|_test)\.[a-z]+$/i.test(filePath) ||
    /\/__tests__\//.test(filePath) ||
    /\/test\//.test(filePath)
}

// ── Core Classification ────────────────────────────────────────────────────────

/**
 * Classify the type of change between old and new entity versions.
 */
export function classifyChange(
  oldEntity: EntityDoc,
  newEntity: EntityDoc,
): ChangeClassification {
  const oldSig = String(oldEntity.signature ?? "")
  const newSig = String(newEntity.signature ?? "")
  const oldBody = String((oldEntity as Record<string, unknown>).body ?? "")
  const newBody = String((newEntity as Record<string, unknown>).body ?? "")

  // 1. Check signature change
  if (oldSig !== newSig) {
    return {
      changeType: "signature_changed",
      shouldCascade: true,
      reason: "Contract change: signature modified",
    }
  }

  // 2. Strip comments and whitespace — if identical after stripping, it's comments-only
  const oldStripped = stripCommentsAndWhitespace(oldBody)
  const newStripped = stripCommentsAndWhitespace(newBody)

  if (oldStripped === newStripped) {
    return {
      changeType: "comments_only",
      shouldCascade: false,
      reason: "Cosmetic: comments/whitespace only",
    }
  }

  // 3. Check test assertions (for test files)
  if (isTestFile(newEntity.file_path)) {
    const oldAssertions = extractTestAssertions(oldBody)
    const newAssertions = extractTestAssertions(newBody)
    if (oldAssertions.join("|") !== newAssertions.join("|")) {
      return {
        changeType: "test_assertions",
        shouldCascade: true,
        reason: "Intent changed: test assertions modified",
      }
    }
  }

  // 4. Check semantic anchors
  const oldAnchors = extractAnchors(oldBody)
  const newAnchors = extractAnchors(newBody)

  if (oldAnchors.join("|") !== newAnchors.join("|")) {
    return {
      changeType: "anchors_changed",
      shouldCascade: true,
      reason: "Business logic changed: semantic anchors differ",
    }
  }

  // 5. Body changed but anchors same → body refactor
  return {
    changeType: "body_refactor",
    shouldCascade: false, // Will be determined by cosine check in shouldCascadeChange
    reason: "Internal refactor: body changed, anchors preserved",
  }
}

/**
 * Determine if a callee's change should cascade to its callers.
 * For body_refactor type, optionally checks cosine similarity.
 */
export function shouldCascadeChange(
  classification: ChangeClassification,
  cosineSimilarity?: number,
): { cascade: boolean; reason: string } {
  // For types with definitive cascade decisions
  if (classification.changeType !== "body_refactor") {
    return { cascade: classification.shouldCascade, reason: classification.reason }
  }

  // body_refactor: check cosine similarity if available
  if (cosineSimilarity != null && cosineSimilarity > 0.95) {
    return {
      cascade: false,
      reason: `Body refactor: cosine similarity ${(cosineSimilarity * 100).toFixed(1)}% > 95% threshold — skip cascade`,
    }
  }

  // No cosine similarity available or below threshold → cascade
  return {
    cascade: true,
    reason: cosineSimilarity != null
      ? `Body refactor: cosine similarity ${(cosineSimilarity * 100).toFixed(1)}% <= 95% threshold — cascade`
      : "Body refactor: no cosine similarity available — conservative cascade",
  }
}
