import { heartbeat } from "@temporalio/activity"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getContainer } from "@/lib/di/container"
import { entityHash } from "@/lib/indexer/entity-hash"
import { createFileEntity } from "@/lib/indexer/languages/generic"
import { getPluginForExtension, getPluginsForExtensions, initializeRegistry } from "@/lib/indexer/languages/registry"
import { detectWorkspaceRoots } from "@/lib/indexer/monorepo"
import { detectLanguages, scanWorkspace } from "@/lib/indexer/scanner"
import type { ParsedEdge, ParsedEntity } from "@/lib/indexer/types"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

export interface PrepareWorkspaceInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
  provider?: "github" | "local_cli"
  uploadPath?: string
}

export interface PrepareWorkspaceResult {
  workspacePath: string
  languages: string[]
  workspaceRoots: string[]
  lastSha?: string
}

export async function prepareWorkspace(input: PrepareWorkspaceInput): Promise<PrepareWorkspaceResult> {
  const container = getContainer()
  const workspacePath = `/data/workspaces/${input.orgId}/${input.repoId}`

  if (input.provider === "local_cli") {
    // Local CLI upload: download zip from storage and extract
    await prepareLocalCliWorkspace(container, workspacePath, input.uploadPath!)
  } else {
    // Default: GitHub clone
    await container.gitHost.cloneRepo(input.cloneUrl, workspacePath, {
      ref: input.defaultBranch,
      installationId: input.installationId,
    })
  }

  heartbeat("workspace ready, reading HEAD SHA")

  // Read the latest commit SHA from the workspace (only for git repos)
  let lastSha: string | undefined
  if (input.provider !== "local_cli") {
    try {
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
      lastSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf-8" }).trim()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[prepareWorkspace] Failed to read HEAD SHA: ${message}`)
    }
  }

  heartbeat("scanning workspace")

  // Scan files and detect languages
  const files = await scanWorkspace(workspacePath)
  const languages = detectLanguages(files).map((l) => l.language)

  // Detect monorepo roots
  const workspaceInfo = detectWorkspaceRoots(workspacePath)
  const workspaceRoots = workspaceInfo.roots

  return { workspacePath, languages, workspaceRoots, lastSha }
}

/**
 * Download a zip from Supabase Storage and extract it to the workspace path.
 * Used for local_cli repos uploaded via `kap10 push`.
 */
async function prepareLocalCliWorkspace(
  container: { storageProvider: import("@/lib/ports/storage-provider").IStorageProvider },
  workspacePath: string,
  uploadPath: string
): Promise<void> {
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs")
  const { execSync } = require("node:child_process") as typeof import("node:child_process")

  heartbeat("downloading local_cli upload from storage")

  let zipBuffer: Buffer
  try {
    zipBuffer = await container.storageProvider.downloadFile("cli_uploads", uploadPath)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[prepareWorkspace] Failed to download local_cli upload from storage: ${message}`)
  }

  heartbeat("extracting local_cli upload")

  try {
    mkdirSync(workspacePath, { recursive: true })
    const zipPath = `${workspacePath}/../upload.zip`
    writeFileSync(zipPath, zipBuffer)
    execSync(`unzip -o "${zipPath}" -d "${workspacePath}"`, { stdio: "pipe" })

    // Clean up the temporary zip file
    const { unlinkSync } = require("node:fs") as typeof import("node:fs")
    try {
      unlinkSync(zipPath)
    } catch {
      // Non-critical: ignore cleanup failures
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[prepareWorkspace] Failed to extract local_cli upload: ${message}`)
  }
}

export interface RunSCIPInput {
  workspacePath: string
  orgId: string
  repoId: string
  languages: string[]
  workspaceRoots: string[]
}

export interface RunSCIPResult {
  entities: EntityDoc[]
  edges: EdgeDoc[]
  coveredFiles: string[]
}

export async function runSCIP(input: RunSCIPInput): Promise<RunSCIPResult> {
  await initializeRegistry()

  const allEntities: ParsedEntity[] = []
  const allEdges: ParsedEdge[] = []
  const allCoveredFiles: string[] = []

  // Get the set of language plugins to run
  const files = await scanWorkspace(input.workspacePath)
  const extensions = Array.from(new Set(files.map((f) => f.extension)))
  const plugins = getPluginsForExtensions(extensions)

  heartbeat("starting SCIP indexers")

  for (const plugin of plugins) {
    try {
      heartbeat(`running SCIP for ${plugin.id}`)
      const result = await plugin.runSCIP({
        workspacePath: input.workspacePath,
        workspaceRoots: input.workspaceRoots,
        orgId: input.orgId,
        repoId: input.repoId,
      })
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[runSCIP] Plugin ${plugin.id} failed: ${message}`)
    }
  }

  return {
    entities: toEntityDocs(allEntities, input.orgId, input.repoId),
    edges: toEdgeDocs(allEdges, input.orgId, input.repoId),
    coveredFiles: allCoveredFiles,
  }
}

export interface ParseRestInput {
  workspacePath: string
  orgId: string
  repoId: string
  coveredFiles: string[]
}

export interface ParseRestResult {
  extraEntities: EntityDoc[]
  extraEdges: EdgeDoc[]
}

export async function parseRest(input: ParseRestInput): Promise<ParseRestResult> {
  await initializeRegistry()

  const files = await scanWorkspace(input.workspacePath)
  const coveredSet = new Set(input.coveredFiles)
  const allEntities: ParsedEntity[] = []
  const allEdges: ParsedEdge[] = []

  heartbeat("parsing uncovered files")

  // Create file entities for ALL files (every file gets representation)
  for (const file of files) {
    const fileEntity = createFileEntity(input.repoId, file.relativePath)
    allEntities.push(fileEntity)
  }

  // Parse uncovered files with tree-sitter/regex fallback
  const uncoveredFiles = files.filter((f) => !coveredSet.has(f.relativePath))
  let processed = 0

  for (const file of uncoveredFiles) {
    const plugin = getPluginForExtension(file.extension)
    if (!plugin) continue

    try {
      const content = readFileSync(file.absolutePath, "utf-8")
      const result = await plugin.parseWithTreeSitter({
        filePath: file.relativePath,
        content,
        orgId: input.orgId,
        repoId: input.repoId,
      })
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)

      // Create contains edges: file → entity
      const fileId = entityHash(input.repoId, file.relativePath, "file", file.relativePath)
      for (const entity of result.entities) {
        allEdges.push({ from_id: fileId, to_id: entity.id, kind: "contains" })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[parseRest] Failed to parse ${file.relativePath}: ${message}`)
    }

    processed++
    if (processed % 100 === 0) {
      heartbeat(`parsed ${processed}/${uncoveredFiles.length} files`)
    }
  }

  return {
    extraEntities: toEntityDocs(allEntities, input.orgId, input.repoId),
    extraEdges: toEdgeDocs(allEdges, input.orgId, input.repoId),
  }
}

/** Convert ParsedEntity[] to EntityDoc[] (domain type → port type) */
function toEntityDocs(entities: ParsedEntity[], orgId: string, repoId: string): EntityDoc[] {
  return entities.map((e) => ({
    id: e.id,
    org_id: orgId,
    repo_id: repoId,
    kind: e.kind,
    name: e.name,
    file_path: e.file_path,
    start_line: e.start_line,
    end_line: e.end_line,
    language: e.language,
    signature: e.signature,
    exported: e.exported,
    doc: e.doc,
    parent: e.parent,
  }))
}

/** Convert ParsedEdge[] to EdgeDoc[] (domain type → port type) */
function toEdgeDocs(edges: ParsedEdge[], orgId: string, repoId: string): EdgeDoc[] {
  return edges.map((e) => ({
    _from: e.from_id,
    _to: e.to_id,
    org_id: orgId,
    repo_id: repoId,
    kind: e.kind,
  }))
}
