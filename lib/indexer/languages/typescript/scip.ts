/**
 * SCIP indexer for TypeScript/JavaScript.
 *
 * Runs `npx @sourcegraph/scip-typescript index` to produce a .scip file,
 * then parses the protobuf output into ParsedEntity[] and ParsedEdge[]
 * using the shared SCIP decoder.
 */
import { execFile } from "node:child_process"
import { existsSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { logger } from "@/lib/utils/logger"
import { parseSCIPOutput } from "../../scip-decoder"
import type { SCIPOptions } from "../types"

const execFileAsync = promisify(execFile)
const log = logger.child({ service: "scip-typescript" })

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
  const absRoot = join(opts.indexDir, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    // Check if tsconfig exists (scip-typescript requires it)
    const hasTsConfig =
      existsSync(join(absRoot, "tsconfig.json")) || existsSync(join(absRoot, "jsconfig.json"))

    if (!hasTsConfig) {
      log.warn("No tsconfig.json or jsconfig.json found — skipping SCIP", { workspaceRoot, absRoot })
      return { entities: [], edges: [], coveredFiles: [] }
    }

    log.info("Running scip-typescript", { workspaceRoot, absRoot })

    // Run scip-typescript
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["--yes", "@sourcegraph/scip-typescript", "index", "--output", outputFile],
      {
        cwd: absRoot,
        timeout: SCIP_TIMEOUT_MS,
        maxBuffer: 100 * 1024 * 1024, // 100MB
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
      },
    )

    if (stderr) {
      log.warn("scip-typescript stderr", { workspaceRoot, stderr: stderr.slice(0, 2000) })
    }
    if (stdout) {
      log.info("scip-typescript stdout", { workspaceRoot, stdout: stdout.slice(0, 1000) })
    }

    // Parse the .scip output file
    if (!existsSync(outputFile)) {
      log.warn("scip-typescript completed but no index.scip file produced", { workspaceRoot, absRoot })
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const fileSize = statSync(outputFile).size
    log.info("Parsing SCIP output", { workspaceRoot, outputFile, fileSizeBytes: fileSize })

    const result = parseSCIPOutput(outputFile, opts.repoId, "typescript", opts.isIncluded)

    log.info("SCIP parsing complete", {
      workspaceRoot,
      entities: result.entities.length,
      edges: result.edges.length,
      coveredFiles: result.coveredFiles.length,
    })

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    // Include stderr if available (exec errors often have it)
    const stderr = (error as { stderr?: string }).stderr
    log.error("scip-typescript failed", {
      workspaceRoot,
      absRoot,
      error: message.slice(0, 2000),
      stderr: stderr ? stderr.slice(0, 2000) : undefined,
    })
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
