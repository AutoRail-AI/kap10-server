/**
 * SCIP indexer for Ruby via scip-ruby (Sorbet-based).
 *
 * scip-ruby is a SCIP indexer powered by Sorbet, maintained by Sourcegraph.
 * Status: partially available. Requires Sorbet-compatible Ruby project
 * (Gemfile present). Falls back gracefully if not installed.
 */
import { execFile } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { parseSCIPOutput } from "../../scip-decoder"
import type { ParsedEdge, ParsedEntity } from "../../types"
import type { SCIPOptions } from "../types"

const execFileAsync = promisify(execFile)

const SCIP_TIMEOUT_MS = 10 * 60 * 1000

export interface SCIPRubyResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

export async function runSCIPRuby(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPRubyResult> {
  const absRoot = join(opts.indexDir, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    if (!existsSync(join(absRoot, "Gemfile"))) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    await execFileAsync("scip-ruby", ["--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "ruby")

    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-ruby] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
