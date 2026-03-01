/**
 * SCIP indexer for Python.
 *
 * Runs scip-python to produce a .scip file, then parses the output
 * using the shared SCIP protobuf decoder.
 * Falls back gracefully if scip-python is not installed.
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

export interface SCIPPythonResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-python on a workspace root and parse the output.
 * Falls back gracefully if scip-python is not installed.
 */
export async function runSCIPPython(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPPythonResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    // Check for Python project markers
    const hasPyProject =
      existsSync(join(absRoot, "pyproject.toml")) ||
      existsSync(join(absRoot, "setup.py")) ||
      existsSync(join(absRoot, "requirements.txt"))

    if (!hasPyProject) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    // Try running scip-python (may not be installed)
    await execFileAsync("scip-python", ["index", "--output", outputFile, "--project-name", "project"], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    // Parse the .scip output file using the shared decoder
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "python")

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    // scip-python not installed or failed — fall through to tree-sitter
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-python] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
