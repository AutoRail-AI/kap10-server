/**
 * Phase 6: Pattern detection activities for Temporal.
 * Primary activity: scanSynthesizeAndStore (combined — no large payloads cross Temporal)
 * Legacy pipeline: astGrepScan (heavy) → llmSynthesizeRules (light) → storePatterns (light)
 */

import { heartbeat } from "@temporalio/activity"

/**
 * Combined activity: scan patterns, synthesize rules, and store — all in one step.
 * Pattern evidence arrays stay inside the worker, only counts cross Temporal.
 */
export async function scanSynthesizeAndStore(input: AstGrepScanInput): Promise<{
  patternsDetected: number
  rulesGenerated: number
}> {
  const scanResult = await astGrepScan(input)
  if (scanResult.detectedPatterns.length === 0) {
    return { patternsDetected: 0, rulesGenerated: 0 }
  }

  const synthesizeResult = await llmSynthesizeRules({
    orgId: input.orgId,
    repoId: input.repoId,
    detectedPatterns: scanResult.detectedPatterns,
  })

  const storeResult = await storePatterns({
    orgId: input.orgId,
    repoId: input.repoId,
    detectedPatterns: scanResult.detectedPatterns,
    synthesizedRules: synthesizeResult.synthesizedRules,
  })

  return { patternsDetected: storeResult.patternsStored, rulesGenerated: storeResult.rulesStored }
}

export interface AstGrepScanInput {
  orgId: string
  repoId: string
  workspacePath: string
  languages: string[]
}

export interface AstGrepScanOutput {
  detectedPatterns: Array<{
    id: string
    type: string
    title: string
    language: string
    query: string
    evidence: Array<{ file: string; line: number; snippet?: string }>
    matchCount: number
    totalFiles: number
  }>
}

export async function astGrepScan(input: AstGrepScanInput): Promise<AstGrepScanOutput> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const { loadCatalogPatterns } = require("@/lib/patterns/catalog-loader") as typeof import("@/lib/patterns/catalog-loader")
  const container = getContainer()

  const catalogPatterns = loadCatalogPatterns()
  const detectedPatterns: AstGrepScanOutput["detectedPatterns"] = []

  for (const language of input.languages) {
    heartbeat(`Scanning ${language} patterns`)

    const langPatterns = catalogPatterns.filter((p) => p.language === language)

    for (const pattern of langPatterns) {
      try {
        const results = await container.patternEngine.scanWithAstGrep(
          input.workspacePath,
          pattern.pattern,
          language
        )

        if (results.length > 0) {
          const crypto = require("node:crypto") as typeof import("node:crypto")
          detectedPatterns.push({
            id: crypto.createHash("sha256").update(`${input.repoId}:${pattern.id}`).digest("hex").slice(0, 16),
            type: pattern.type,
            title: pattern.title,
            language,
            query: pattern.pattern,
            evidence: results.slice(0, 10).map((r) => ({
              file: r.file,
              line: r.line,
              snippet: r.matchedCode?.slice(0, 200),
            })),
            matchCount: results.length,
            totalFiles: new Set(results.map((r) => r.file)).size,
          })
        }
      } catch {
        // Skip failing patterns
      }
    }
  }

  heartbeat(`Found ${detectedPatterns.length} patterns`)
  return { detectedPatterns }
}

export interface LlmSynthesizeInput {
  orgId: string
  repoId: string
  detectedPatterns: AstGrepScanOutput["detectedPatterns"]
}

export interface SynthesizedRule {
  patternId: string
  title: string
  description: string
  type: string
  enforcement: "suggest" | "warn"
  semgrepRule?: string
  confidence: number
}

export interface LlmSynthesizeOutput {
  synthesizedRules: SynthesizedRule[]
}

export async function llmSynthesizeRules(input: LlmSynthesizeInput): Promise<LlmSynthesizeOutput> {
  heartbeat("Synthesizing rules from patterns")

  // For patterns with high match counts, auto-generate rule suggestions
  const synthesizedRules: SynthesizedRule[] = []

  for (const pattern of input.detectedPatterns) {
    // Auto-synthesize rule if pattern appears frequently
    if (pattern.matchCount >= 3) {
      synthesizedRules.push({
        patternId: pattern.id,
        title: pattern.title,
        description: `Auto-detected pattern: ${pattern.title} (found ${pattern.matchCount} instances across ${pattern.totalFiles} files)`,
        type: pattern.type,
        enforcement: pattern.matchCount >= 10 ? "warn" : "suggest",
        confidence: Math.min(pattern.matchCount / 20, 1),
      })
    }
  }

  heartbeat(`Synthesized ${synthesizedRules.length} rules`)
  return { synthesizedRules }
}

export interface StorePatternsInput {
  orgId: string
  repoId: string
  detectedPatterns: AstGrepScanOutput["detectedPatterns"]
  synthesizedRules: SynthesizedRule[]
}

export async function storePatterns(input: StorePatternsInput): Promise<{ patternsStored: number; rulesStored: number }> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const container = getContainer()

  heartbeat("Storing patterns")

  let patternsStored = 0
  for (const pattern of input.detectedPatterns) {
    // Check if already exists
    const existing = await container.graphStore.getPatternByHash(input.orgId, input.repoId, pattern.id)
    if (!existing) {
      await container.graphStore.upsertPattern(input.orgId, {
        id: pattern.id,
        org_id: input.orgId,
        repo_id: input.repoId,
        name: pattern.title.toLowerCase().replace(/\s+/g, "-"),
        type: pattern.type as "structural" | "naming" | "error-handling" | "import" | "testing" | "custom",
        title: pattern.title,
        astGrepQuery: pattern.query,
        evidence: pattern.evidence,
        adherenceRate: Math.min(pattern.matchCount / Math.max(pattern.totalFiles, 1), 1),
        confidence: Math.min(pattern.matchCount / 20, 0.95),
        status: "detected",
        source: "ast-grep",
        language: pattern.language,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      patternsStored++
    }
  }

  heartbeat("Storing synthesized rules")
  let rulesStored = 0
  for (const rule of input.synthesizedRules) {
    const crypto = require("node:crypto") as typeof import("node:crypto")
    const ruleId = crypto.createHash("sha256").update(`${input.repoId}:rule:${rule.patternId}`).digest("hex").slice(0, 16)

    await container.graphStore.upsertRule(input.orgId, {
      id: ruleId,
      org_id: input.orgId,
      repo_id: input.repoId,
      name: rule.title.toLowerCase().replace(/\s+/g, "-"),
      title: rule.title,
      description: rule.description,
      type: rule.type as "architecture" | "naming" | "security" | "performance" | "style" | "custom",
      scope: "repo",
      enforcement: rule.enforcement,
      priority: 30,
      status: "draft",
      languages: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    rulesStored++
  }

  return { patternsStored, rulesStored }
}
