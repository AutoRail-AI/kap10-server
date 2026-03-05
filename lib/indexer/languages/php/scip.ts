/**
 * SCIP indexer for PHP via scip-php.
 *
 * scip-php is a third-party SCIP indexer using nikic/php-parser.
 * Requires PHP 8.2+ and composer. Status: early (v0.0.2).
 * Install: `composer global require davidrjenni/scip-php`
 *
 * Falls back gracefully if scip-php is not installed or the project
 * lacks a composer.json.
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

export interface SCIPPhpResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

export async function runSCIPPhp(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPPhpResult> {
  const absRoot = join(opts.indexDir, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    if (!existsSync(join(absRoot, "composer.json"))) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    await execFileAsync("scip-php", ["index", "--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "php", opts.isIncluded)

    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-php] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
