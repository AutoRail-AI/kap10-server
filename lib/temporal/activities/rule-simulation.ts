/**
 * Phase 6: Blast radius simulation activities.
 */

import { heartbeat } from "@temporalio/activity"
import type { AstGrepResult, ImpactReportDoc } from "@/lib/ports/types"

export interface SimulateRuleInput {
  orgId: string
  repoId: string
  ruleId: string
  workspacePath: string
  astGrepQuery: string
  language: string
}

export async function simulateRuleBlastRadius(input: SimulateRuleInput): Promise<ImpactReportDoc> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const { generateImpactReport } = require("@/lib/rules/impact-report") as typeof import("@/lib/rules/impact-report")
  const container = getContainer()

  heartbeat("Scanning workspace for violations")

  const findings: AstGrepResult[] = await container.patternEngine.scanWithAstGrep(
    input.workspacePath,
    input.astGrepQuery,
    input.language
  )

  heartbeat(`Found ${findings.length} violations, generating report`)

  // Count total files for context
  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  let totalFiles = 0
  function countFiles(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !["node_modules", ".git", "dist"].includes(entry.name)) {
          countFiles(path.join(dir, entry.name))
        } else if (entry.isFile()) {
          totalFiles++
        }
      }
    } catch { /* skip */ }
  }
  countFiles(input.workspacePath)

  const report = generateImpactReport(
    input.orgId,
    input.repoId,
    input.ruleId,
    findings,
    totalFiles
  )

  // Store the report
  await container.graphStore.upsertImpactReport(input.orgId, report)

  return report
}
