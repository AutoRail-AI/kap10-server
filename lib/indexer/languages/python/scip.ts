/**
 * SCIP indexer for Python.
 *
 * Runs scip-python to produce a .scip file, then parses the output.
 * Falls back gracefully if scip-python is not installed.
 */
import { execFile } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

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
 * Run scip-python on a workspace root.
 * Currently returns empty (scip-python is less mature than scip-typescript).
 * The tree-sitter fallback handles Python parsing in Phase 1.
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

    // If we get here, scip-python succeeded
    // For Phase 1, we rely on tree-sitter for Python parsing
    // since scip-python output parsing shares the same protobuf format
    // TODO: Parse SCIP output using shared decoder

    try {
      unlinkSync(outputFile)
    } catch {
      // ignore
    }

    return { entities: [], edges: [], coveredFiles: [] }
  } catch {
    // scip-python not installed or failed — expected in Phase 1
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
