/**
 * SCIP indexer for Go.
 *
 * Runs scip-go to produce a .scip file. Falls back gracefully
 * if scip-go is not installed.
 */
import { execFile } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import type { ParsedEdge, ParsedEntity } from "../../types"
import type { SCIPOptions } from "../types"

const execFileAsync = promisify(execFile)

const SCIP_TIMEOUT_MS = 10 * 60 * 1000

export interface SCIPGoResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-go on a workspace root.
 * Currently returns empty — tree-sitter fallback handles Go in Phase 1.
 */
export async function runSCIPGo(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPGoResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    if (!existsSync(join(absRoot, "go.mod"))) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    await execFileAsync("scip-go", ["--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    // TODO: Parse SCIP output using shared decoder
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore
    }

    return { entities: [], edges: [], coveredFiles: [] }
  } catch {
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
