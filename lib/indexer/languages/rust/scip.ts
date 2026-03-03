/**
 * SCIP indexer for Rust via scip-rust (rust-analyzer wrapper).
 *
 * scip-rust wraps rust-analyzer to produce SCIP output. Requires
 * rust-analyzer on the system PATH and a Cargo.toml in the workspace.
 *
 * Falls back gracefully if scip-rust is not installed or the project
 * lacks a Cargo.toml.
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

export interface SCIPRustResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

export async function runSCIPRust(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPRustResult> {
  const absRoot = join(opts.indexDir, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    if (!existsSync(join(absRoot, "Cargo.toml"))) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    await execFileAsync("scip-rust", ["--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "rust")

    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-rust] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
