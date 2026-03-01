/**
 * Phase 6: Pattern detection activities for Temporal.
 * Primary activity: scanSynthesizeAndStore (combined — no large payloads cross Temporal)
 * Legacy pipeline: astGrepScan (heavy) → llmSynthesizeRules (light) → storePatterns (light)
 *
 * L-13: Enhanced with real LLM rule synthesis and semantic pattern mining.
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

/**
 * L-13: Enhanced rule synthesis — uses LLM for patterns with matchCount >= 3,
 * with heuristic fallback on LLM failure.
 */
export async function llmSynthesizeRules(input: LlmSynthesizeInput): Promise<LlmSynthesizeOutput> {
  heartbeat("Synthesizing rules from patterns")

  const eligiblePatterns = input.detectedPatterns.filter((p) => p.matchCount >= 3)
  if (eligiblePatterns.length === 0) {
    return { synthesizedRules: [] }
  }

  // Try LLM-based synthesis, fall back to heuristic on failure
  try {
    const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
    const { LLM_MODELS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
    const { z } = require("zod") as typeof import("zod")
    const container = getContainer()

    // Fetch justifications for business context
    const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
    const featureTags = Array.from(new Set(justifications.map((j) => j.feature_tag).filter(Boolean))).slice(0, 20)
    const businessContext = featureTags.length > 0
      ? `Known feature areas: ${featureTags.join(", ")}`
      : ""

    const synthesizedRules: SynthesizedRule[] = []

    // Batch patterns in groups of 5 for LLM calls
    const BATCH_SIZE = 5
    for (let i = 0; i < eligiblePatterns.length; i += BATCH_SIZE) {
      const batch = eligiblePatterns.slice(i, i + BATCH_SIZE)
      heartbeat(`LLM synthesizing rules batch ${Math.floor(i / BATCH_SIZE) + 1}`)

      const patternDescriptions = batch.map((p) => {
        const evidenceSample = p.evidence.slice(0, 3).map((e) =>
          `  - ${e.file}:${e.line}${e.snippet ? ` → ${e.snippet.slice(0, 100)}` : ""}`
        ).join("\n")
        return `Pattern "${p.title}" (${p.type}, ${p.matchCount} matches in ${p.totalFiles} files):\n${evidenceSample}`
      }).join("\n\n")

      const RuleSynthesisSchema = z.object({
        rules: z.array(z.object({
          patternId: z.string(),
          title: z.string(),
          description: z.string(),
          enforcement: z.enum(["suggest", "warn"]),
          confidence: z.number(),
        })),
      })

      try {
        const { object } = await container.llmProvider.generateObject({
          model: LLM_MODELS.fast,
          schema: RuleSynthesisSchema,
          system: "You are a code quality expert synthesizing enforcement rules from detected code patterns. Generate actionable rules that help teams maintain consistency.",
          prompt: `Analyze these detected code patterns and synthesize enforcement rules.
${businessContext ? `\n${businessContext}\n` : ""}
${patternDescriptions}

For each pattern, generate a rule with:
- patternId: use the pattern title as identifier
- title: concise rule name (e.g., "Require error boundary in async handlers")
- description: explain what the rule enforces and why, referencing the evidence
- enforcement: "warn" if the pattern is a strong convention (10+ matches), otherwise "suggest"
- confidence: 0.0-1.0 based on pattern consistency

Return rules as JSON array. Only include patterns that represent meaningful conventions.`,
        })

        for (const rule of object.rules) {
          const matchingPattern = batch.find((p) => p.title === rule.patternId) ?? batch[0]
          if (matchingPattern) {
            synthesizedRules.push({
              patternId: matchingPattern.id,
              title: rule.title,
              description: rule.description,
              type: matchingPattern.type,
              enforcement: rule.enforcement,
              confidence: Math.min(Math.max(rule.confidence, 0), 1),
            })
          }
        }
      } catch {
        // LLM failed for this batch — fall back to heuristic
        for (const pattern of batch) {
          synthesizedRules.push(heuristicRule(pattern))
        }
      }
    }

    heartbeat(`Synthesized ${synthesizedRules.length} rules (LLM-enhanced)`)
    return { synthesizedRules }
  } catch {
    // Complete LLM failure — fall back to pure heuristic for all patterns
    const synthesizedRules = eligiblePatterns.map(heuristicRule)
    heartbeat(`Synthesized ${synthesizedRules.length} rules (heuristic fallback)`)
    return { synthesizedRules }
  }
}

/** Heuristic fallback rule synthesis (original logic). */
function heuristicRule(pattern: AstGrepScanOutput["detectedPatterns"][number]): SynthesizedRule {
  return {
    patternId: pattern.id,
    title: pattern.title,
    description: `Auto-detected pattern: ${pattern.title} (found ${pattern.matchCount} instances across ${pattern.totalFiles} files)`,
    type: pattern.type,
    enforcement: pattern.matchCount >= 10 ? "warn" : "suggest",
    confidence: Math.min(pattern.matchCount / 20, 1),
  }
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

// ── L-13: Semantic Pattern Mining ──────────────────────────────────────────────

export interface SemanticMiningInput {
  orgId: string
  repoId: string
}

export interface SemanticMiningOutput {
  clustersFound: number
  rulesGenerated: number
}

/**
 * L-13: Semantic pattern mining — discovers structural conventions
 * within Louvain communities by analyzing call sequence motifs.
 *
 * Runs on light-llm-queue (needs LLM for convention naming).
 */
export async function semanticPatternMining(input: SemanticMiningInput): Promise<SemanticMiningOutput> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const { LLM_MODELS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  const { z } = require("zod") as typeof import("zod")
  const crypto = require("node:crypto") as typeof import("node:crypto")
  const container = getContainer()
  const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")

  const sLog = log.child({ service: "semantic-pattern-mining", organizationId: input.orgId, repoId: input.repoId })

  heartbeat("Fetching entities and edges")

  // Step 1: Fetch all entities and edges
  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const allEdges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  heartbeat(`Loaded ${allEntities.length} entities, ${allEdges.length} edges`)

  // Step 2: Group entities by community_id
  const communities = new Map<number, typeof allEntities>()
  for (const entity of allEntities) {
    const communityId = (entity as Record<string, unknown>).community_id as number | undefined
    if (communityId == null) continue
    let group = communities.get(communityId)
    if (!group) {
      group = []
      communities.set(communityId, group)
    }
    group.push(entity)
  }

  sLog.info(`Found ${communities.size} communities`)

  // Step 3: For each community with 5+ callable entities, extract motifs
  const callableKinds = new Set(["function", "method", "decorator"])
  const callEdges = allEdges.filter((e) => e.kind === "calls")

  // Build adjacency from call edges
  const callAdj = new Map<string, string[]>()
  for (const edge of callEdges) {
    const from = String(edge._from).split("/").pop() ?? ""
    const to = String(edge._to).split("/").pop() ?? ""
    let list = callAdj.get(from)
    if (!list) {
      list = []
      callAdj.set(from, list)
    }
    list.push(to)
  }

  let clustersFound = 0
  let rulesGenerated = 0

  const ConventionSchema = z.object({
    conventions: z.array(z.object({
      title: z.string(),
      description: z.string(),
      violationGuidance: z.string(),
    })),
  })

  for (const [communityId, entities] of Array.from(communities.entries())) {
    const callableEntities = entities.filter((e: typeof allEntities[number]) => callableKinds.has(e.kind))
    if (callableEntities.length < 5) continue

    heartbeat(`Analyzing community ${communityId} (${callableEntities.length} callables)`)

    const communityEntityIds = new Set(callableEntities.map((e: typeof allEntities[number]) => e.id))

    // Extract call sequence motifs (paths of length 2-3 within community)
    const motifCounts = new Map<string, number>()
    const motifExamples = new Map<string, string[]>()

    for (const entity of callableEntities) {
      const callees = (callAdj.get(entity.id) ?? []).filter((id) => communityEntityIds.has(id))
      for (const callee of callees) {
        // Length-2 motif: entity.kind → callee.kind
        const calleeEntity = callableEntities.find((e: typeof allEntities[number]) => e.id === callee)
        if (!calleeEntity) continue

        const motif2 = `${entity.kind}→${calleeEntity.kind}`
        motifCounts.set(motif2, (motifCounts.get(motif2) ?? 0) + 1)

        // Track examples
        const examples2 = motifExamples.get(motif2)
        if (examples2) {
          if (examples2.length < 3) examples2.push(`${entity.name}→${calleeEntity.name}`)
        } else {
          motifExamples.set(motif2, [`${entity.name}→${calleeEntity.name}`])
        }

        // Length-3 motif: entity.kind → callee.kind → grandchild.kind
        const grandCallees = (callAdj.get(callee) ?? []).filter((id) => communityEntityIds.has(id))
        for (const gc of grandCallees.slice(0, 5)) {
          const gcEntity = callableEntities.find((e: typeof allEntities[number]) => e.id === gc)
          if (!gcEntity) continue
          const motif3 = `${entity.kind}→${calleeEntity.kind}→${gcEntity.kind}`
          motifCounts.set(motif3, (motifCounts.get(motif3) ?? 0) + 1)

          const examples3 = motifExamples.get(motif3)
          if (examples3) {
            if (examples3.length < 3) examples3.push(`${entity.name}→${calleeEntity.name}→${gcEntity.name}`)
          } else {
            motifExamples.set(motif3, [`${entity.name}→${calleeEntity.name}→${gcEntity.name}`])
          }
        }
      }
    }

    // Find repeated motifs with adherence >= 60%
    const repeatedMotifs: Array<{ motif: string; count: number; adherence: number; examples: string[] }> = []
    for (const [motif, count] of Array.from(motifCounts.entries())) {
      const adherence = count / callableEntities.length
      if (adherence >= 0.6 && count >= 3) {
        repeatedMotifs.push({
          motif,
          count,
          adherence,
          examples: motifExamples.get(motif) ?? [],
        })
      }
    }

    if (repeatedMotifs.length === 0) continue
    clustersFound++

    // Fetch justifications for member entities (for business context)
    const memberNames = callableEntities.slice(0, 10).map((e: typeof allEntities[number]) => e.name)
    const memberPurposes: string[] = []
    for (const entity of callableEntities.slice(0, 5)) {
      const justification = await container.graphStore.getJustification(input.orgId, entity.id)
      if (justification) {
        memberPurposes.push(`${entity.name}: ${justification.business_purpose}`)
      }
    }

    // LLM: synthesize convention from motifs + business context
    const motifDesc = repeatedMotifs.slice(0, 5).map((m) =>
      `- Pattern "${m.motif}" (${m.count} occurrences, ${Math.round(m.adherence * 100)}% adherence): ${m.examples.join(", ")}`
    ).join("\n")

    try {
      const { object } = await container.llmProvider.generateObject({
        model: LLM_MODELS.fast,
        schema: ConventionSchema,
        system: "You are a code architecture analyst discovering implicit conventions in codebases.",
        prompt: `A code community contains these entities: ${memberNames.join(", ")}
${memberPurposes.length > 0 ? `\nBusiness purposes:\n${memberPurposes.join("\n")}` : ""}

Structural patterns found:
${motifDesc}

Synthesize 1-2 conventions that these patterns represent. For each:
- title: short convention name (e.g., "Service-Repository Pattern", "Handler-Validator Chain")
- description: what the convention is and why it matters
- violationGuidance: how to fix code that doesn't follow this pattern`,
      })

      for (const conv of object.conventions) {
        const motifHash = crypto.createHash("sha256")
          .update(`${input.repoId}:semantic:${communityId}:${conv.title}`)
          .digest("hex").slice(0, 16)

        // Store as mined pattern
        await container.graphStore.upsertMinedPattern(input.orgId, {
          id: motifHash,
          org_id: input.orgId,
          repo_id: input.repoId,
          community_id: communityId,
          motif_hash: motifHash,
          entity_keys: callableEntities.slice(0, 20).map((e: typeof allEntities[number]) => e.id),
          edge_count: repeatedMotifs.reduce((sum: number, m) => sum + m.count, 0),
          label: conv.title,
          confidence: Math.max(...repeatedMotifs.map((m) => m.adherence)),
          status: "pending",
          created_at: new Date().toISOString(),
        })

        // Store as rule
        const ruleId = crypto.createHash("sha256")
          .update(`${input.repoId}:semantic-rule:${motifHash}`)
          .digest("hex").slice(0, 16)

        await container.graphStore.upsertRule(input.orgId, {
          id: ruleId,
          org_id: input.orgId,
          repo_id: input.repoId,
          name: conv.title.toLowerCase().replace(/\s+/g, "-"),
          title: conv.title,
          description: `${conv.description}\n\nViolation guidance: ${conv.violationGuidance}`,
          type: "architecture",
          scope: "repo",
          enforcement: "suggest",
          priority: 20,
          status: "draft",
          languages: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        rulesGenerated++
      }
    } catch {
      sLog.warn(`LLM convention synthesis failed for community ${communityId}, skipping`)
    }
  }

  sLog.info("Semantic pattern mining complete", { clustersFound, rulesGenerated })
  heartbeat("Semantic mining complete")

  return { clustersFound, rulesGenerated }
}
