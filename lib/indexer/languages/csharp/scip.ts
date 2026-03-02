/**
 * SCIP indexer for C# via scip-dotnet.
 *
 * scip-dotnet is a Roslyn-based SCIP indexer from Sourcegraph, generally
 * available for production use. Requires .NET 8.0+ SDK on the worker.
 * Install: `dotnet tool install --global scip-dotnet`
 *
 * Falls back gracefully if scip-dotnet is not installed or the project
 * lacks a .sln or .csproj file.
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

export interface SCIPDotnetResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

export async function runSCIPDotnet(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPDotnetResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    const hasDotnetProject =
      existsSync(join(absRoot, `${absRoot.split("/").pop()}.sln`)) ||
      existsSync(join(absRoot, `${absRoot.split("/").pop()}.csproj`))

    // Also check for any .sln or .csproj at root level
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    const hasAnyProject = hasDotnetProject || readdirSync(absRoot).some(
      (f: string) => f.endsWith(".sln") || f.endsWith(".csproj"),
    )

    if (!hasAnyProject) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    await execFileAsync("scip-dotnet", ["index", "--output", outputFile], {
      cwd: absRoot,
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
    })

    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.repoId, "csharp")

    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-dotnet] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}
