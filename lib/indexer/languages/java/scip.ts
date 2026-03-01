/**
 * SCIP indexer for Java.
 *
 * Runs scip-java to produce a .scip file, then parses the output
 * using the shared SCIP protobuf decoder.
 * Falls back gracefully if scip-java is not installed.
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

export interface SCIPJavaResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-java on a workspace root and parse the output.
 * Falls back gracefully if scip-java is not installed.
 *
 * Detects Maven (pom.xml), Gradle (build.gradle / build.gradle.kts),
 * or bare Java sources.
 */
export async function runSCIPJava(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPJavaResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    // Check for Java project markers
    const hasJavaProject =
      existsSync(join(absRoot, "pom.xml")) ||
      existsSync(join(absRoot, "build.gradle")) ||
      existsSync(join(absRoot, "build.gradle.kts"))

    if (!hasJavaProject) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    // scip-java index produces index.scip in the working directory
    await execFileAsync("scip-java", ["index", "--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    // Parse the .scip output file using the shared decoder
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "java")

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    // scip-java not installed or failed — fall through to tree-sitter
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-java] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
