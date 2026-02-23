/**
 * Env Var Disconnect Check (G9) — detects process.env references not in .env.example.
 */

import type { EnvFinding, ReviewConfig } from "@/lib/ports/types"

export interface DiffHunk {
  content: string
  newStart: number
}

export interface DiffFile {
  path: string
  hunks: DiffHunk[]
}

const ENV_REGEX = /process\.env\.([A-Z][A-Z0-9_]*)/g

export async function runEnvCheck(
  diffFiles: DiffFile[],
  workspacePath: string,
  config: ReviewConfig
): Promise<EnvFinding[]> {
  if (!config.checksEnabled.env) return []

  const findings: EnvFinding[] = []

  // Read .env.example to get known env vars
  const knownVars = new Set<string>()
  try {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const envExamplePath = path.join(workspacePath, ".env.example")
    if (fs.existsSync(envExamplePath)) {
      const content = fs.readFileSync(envExamplePath, "utf-8")
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIndex = trimmed.indexOf("=")
          if (eqIndex > 0) {
            knownVars.add(trimmed.slice(0, eqIndex).trim())
          }
        }
      }
    }
  } catch {
    // If we can't read .env.example, flag all new env vars
  }

  // Scan diff hunks for new process.env references
  for (const file of diffFiles) {
    for (const hunk of file.hunks) {
      const lines = hunk.content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        // Only check added lines (start with +)
        if (!line.startsWith("+")) continue

        let match: RegExpExecArray | null
        ENV_REGEX.lastIndex = 0
        while ((match = ENV_REGEX.exec(line)) !== null) {
          const envVar = match[1]!
          if (!knownVars.has(envVar)) {
            findings.push({
              filePath: file.path,
              line: hunk.newStart + i,
              envVar,
              message: `\`process.env.${envVar}\` is not defined in \`.env.example\`. Add it to ensure all developers and CI have the required variable.`,
            })
          }
        }
      }
    }
  }

  return findings
}
