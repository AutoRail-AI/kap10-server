/**
 * SCIP indexer for Python.
 *
 * Runs scip-python to produce a .scip file, then parses the output
 * using the shared SCIP protobuf decoder.
 * Falls back gracefully if scip-python is not installed.
 */
import { execFile } from "node:child_process"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
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
  const absRoot = join(opts.indexDir, workspaceRoot === "." ? "" : workspaceRoot)
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

    // Resolve the actual project name from pyproject.toml or setup.cfg
    const projectName = resolvePythonProjectName(absRoot)

    // Try running scip-python (may not be installed)
    await execFileAsync("scip-python", ["index", "--output", outputFile, "--project-name", projectName], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    // Parse the .scip output file using the shared decoder
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "python", opts.isIncluded)

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

/**
 * Resolve the Python project name from pyproject.toml or setup.cfg.
 * Falls back to "project" (scip-python default) if not found.
 */
function resolvePythonProjectName(absRoot: string): string {
  // Try pyproject.toml [project].name first
  const pyproject = join(absRoot, "pyproject.toml")
  if (existsSync(pyproject)) {
    try {
      const content = readFileSync(pyproject, "utf-8")
      const nameMatch = content.match(/\[project\]\s*[\s\S]*?name\s*=\s*"([^"]+)"/)
      if (nameMatch?.[1]) return nameMatch[1]
    } catch { /* ignore */ }
  }

  // Try setup.cfg [metadata].name
  const setupCfg = join(absRoot, "setup.cfg")
  if (existsSync(setupCfg)) {
    try {
      const content = readFileSync(setupCfg, "utf-8")
      const nameMatch = content.match(/\[metadata\]\s*[\s\S]*?name\s*=\s*(.+)/)
      if (nameMatch?.[1]) return nameMatch[1].trim()
    } catch { /* ignore */ }
  }

  return "project"
}
