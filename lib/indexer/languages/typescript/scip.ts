/**
 * SCIP indexer for TypeScript/JavaScript.
 *
 * Runs `npx @sourcegraph/scip-typescript index` to produce a .scip file,
 * then parses the protobuf output into ParsedEntity[] and ParsedEdge[]
 * using the shared SCIP decoder.
 */
import { execFile } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { parseSCIPOutput } from "../../scip-decoder"
import type { SCIPOptions } from "../types"

const execFileAsync = promisify(execFile)

/** Maximum time for scip-typescript to run (10 minutes) */
const SCIP_TIMEOUT_MS = 10 * 60 * 1000

export interface SCIPIndexResult {
  entities: import("../../types").ParsedEntity[]
  edges: import("../../types").ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-typescript on a workspace root and parse the output.
 * Falls back gracefully if SCIP is unavailable or fails.
 */
export async function runSCIPTypeScript(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPIndexResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    // Check if tsconfig exists (scip-typescript requires it)
    const hasTsConfig =
      existsSync(join(absRoot, "tsconfig.json")) || existsSync(join(absRoot, "jsconfig.json"))

    if (!hasTsConfig) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    // Run scip-typescript
    await execFileAsync(
      "npx",
      ["--yes", "@sourcegraph/scip-typescript", "index", "--output", outputFile],
      {
        cwd: absRoot,
        timeout: SCIP_TIMEOUT_MS,
        maxBuffer: 100 * 1024 * 1024, // 100MB
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
      },
    )

    // Parse the .scip output file
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "typescript")

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-typescript] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
