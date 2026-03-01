/**
 * SCIP indexer for Go.
 *
 * Runs scip-go to produce a .scip file, then parses the output
 * using the shared SCIP protobuf decoder.
 * Falls back gracefully if scip-go is not installed.
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

export interface SCIPGoResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-go on a workspace root and parse the output.
 * Falls back gracefully if scip-go is not installed.
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

    // Parse the .scip output file using the shared decoder
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "go")

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    // scip-go not installed or failed — fall through to tree-sitter
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-go] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
