import { heartbeat } from "@temporalio/activity"
import { execFile } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

import { getContainer } from "@/lib/di/container"
import { extractDocComment } from "@/lib/indexer/doc-extractor"
import { entityHash } from "@/lib/indexer/entity-hash"
import { readFileWithEncoding } from "@/lib/indexer/file-reader"
import { resolveCrossFileCalls } from "@/lib/indexer/cross-file-calls"
import { createFileEntity } from "@/lib/indexer/languages/generic"
import { getPluginForExtension, getPluginsForExtensions, initializeRegistry } from "@/lib/indexer/languages/registry"
import { detectLanguagePerRoot, detectWorkspaceRoots } from "@/lib/indexer/monorepo"
import { detectLanguages, scanWorkspace } from "@/lib/indexer/scanner"
import type { ParsedEdge, ParsedEntity } from "@/lib/indexer/types"
import { MAX_BODY_LINES } from "@/lib/indexer/types"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { writeEntitiesToGraph } from "@/lib/temporal/activities/graph-writer"
import { createPipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

export interface PrepareRepoIntelligenceSpaceInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
  provider?: "github" | "local_cli"
  uploadPath?: string
}

export interface PrepareRepoIntelligenceSpaceResult {
  workspacePath: string
  languages: string[]
  workspaceRoots: string[]
  /** A-05: Dominant language per workspace root for polyglot SCIP indexing */
  languagePerRoot?: Record<string, string>
  lastSha?: string
}

export async function prepareRepoIntelligenceSpace(input: PrepareRepoIntelligenceSpaceInput): Promise<PrepareRepoIntelligenceSpaceResult> {
  const log = logger.child({ service: "indexing-heavy", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "indexing")
  log.info("Preparing workspace", { cloneUrl: input.cloneUrl, defaultBranch: input.defaultBranch, provider: input.provider ?? "github" })
  plog.log("info", "Step 1/7", "Cloning repository and scanning workspace...")
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
      log.warn("Failed to read HEAD SHA", { errorMessage: error instanceof Error ? error.message : String(error) })
    }
  }

  heartbeat("scanning workspace")

  // Scan files and detect languages
  const files = await scanWorkspace(workspacePath)
  const languages = detectLanguages(files).map((l) => l.language)

  // Detect monorepo roots
  const workspaceInfo = detectWorkspaceRoots(workspacePath)
  const workspaceRoots = workspaceInfo.roots

  // A-05: Detect dominant language per workspace root for polyglot SCIP indexing
  const languagePerRoot = workspaceRoots.length > 1
    ? detectLanguagePerRoot(workspacePath, workspaceRoots)
    : undefined

  log.info("Workspace prepared", { workspacePath, languages, rootCount: workspaceRoots.length, languagePerRoot, lastSha })
  plog.log("info", "Step 1/7", `Workspace ready — detected languages: ${languages.join(", ") || "none"}`, { fileCount: files.length })
  return { workspacePath, languages, workspaceRoots, languagePerRoot, lastSha }
}

/**
 * Download a zip from Supabase Storage and extract it to the workspace path.
 * Used for local_cli repos uploaded via `unerr push`.
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
    throw new Error(`[prepareRepoIntelligenceSpace] Failed to download local_cli upload from storage: ${message}`)
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
    throw new Error(`[prepareRepoIntelligenceSpace] Failed to extract local_cli upload: ${message}`)
  }
}

export interface RunSCIPInput {
  workspacePath: string
  orgId: string
  repoId: string
  languages: string[]
  workspaceRoots: string[]
  indexVersion?: string
}

/** @deprecated Use RunSCIPLightResult instead — full arrays no longer cross Temporal. */
export interface RunSCIPResult {
  entities: EntityDoc[]
  edges: EdgeDoc[]
  coveredFiles: string[]
}

export interface RunSCIPLightResult {
  entityCount: number
  edgeCount: number
  coveredFiles: string[]
  fileCount: number
  functionCount: number
  classCount: number
}

/**
 * K-03: Check if a SCIP binary is available on the system PATH.
 * Returns true if found, false otherwise.
 */
async function isSCIPBinaryAvailable(binary: string): Promise<boolean> {
  try {
    await execFileAsync("which", [binary])
    return true
  } catch {
    return false
  }
}

/**
 * Run SCIP indexers, write entities/edges directly to ArangoDB,
 * and return only lightweight metadata. Large payloads never leave the worker.
 */
export async function runSCIP(input: RunSCIPInput): Promise<RunSCIPLightResult> {
  const log = logger.child({ service: "indexing-heavy", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "indexing")
  log.info("Starting SCIP indexers", { languages: input.languages })
  plog.log("info", "Step 2/7", `Running SCIP indexers for: ${input.languages.join(", ")}`)

  // K-03: Pre-check SCIP binary availability and surface to pipeline log
  const scipBinaries: Record<string, string> = {
    typescript: "npx", // scip-typescript runs via npx
    python: "scip-python",
    go: "scip-go",
  }
  const missingBinaries: string[] = []
  for (const lang of input.languages) {
    const bin = scipBinaries[lang]
    if (bin && bin !== "npx") {
      const available = await isSCIPBinaryAvailable(bin)
      if (!available) {
        missingBinaries.push(`${bin} (${lang})`)
      }
    }
  }
  if (missingBinaries.length > 0) {
    const msg = `SCIP binaries not found: ${missingBinaries.join(", ")}. These languages will use tree-sitter fallback.`
    log.warn(msg)
    plog.log("warn", "Step 2/7", msg)
  }

  await initializeRegistry()

  const allEntities: ParsedEntity[] = []
  const allEdges: ParsedEdge[] = []
  const allCoveredFiles: string[] = []

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
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.warn(`SCIP plugin ${plugin.id} failed`, { pluginId: plugin.id, errorMessage })
      // K-03: Surface SCIP failures to pipeline log so users see them in the UI
      plog.log("warn", "Step 2/7", `SCIP indexer for ${plugin.id} failed: ${errorMessage}. Falling back to tree-sitter.`)
    }
  }

  heartbeat("filling source bodies for SCIP entities")
  fillBodiesFromSource(allEntities, input.workspacePath)

  // Write directly to ArangoDB — no large payloads cross Temporal
  heartbeat("writing SCIP results to graph store")
  const container = getContainer()
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    toEntityDocs(allEntities, input.orgId, input.repoId),
    toEdgeDocs(allEdges, input.orgId, input.repoId),
    input.indexVersion,
  )

  log.info("SCIP indexing complete", { entityCount: writeResult.entitiesWritten, edgeCount: writeResult.edgesWritten, coveredFiles: allCoveredFiles.length })
  plog.log("info", "Step 2/7", `SCIP complete — wrote ${writeResult.entitiesWritten} entities, ${writeResult.edgesWritten} edges (${writeResult.fileCount} files, ${writeResult.functionCount} functions, ${writeResult.classCount} classes)`)
  return {
    entityCount: writeResult.entitiesWritten,
    edgeCount: writeResult.edgesWritten,
    coveredFiles: allCoveredFiles,
    fileCount: writeResult.fileCount,
    functionCount: writeResult.functionCount,
    classCount: writeResult.classCount,
  }
}

export interface ParseRestInput {
  workspacePath: string
  orgId: string
  repoId: string
  coveredFiles: string[]
  indexVersion?: string
}

/** @deprecated Use ParseRestLightResult instead — full arrays no longer cross Temporal. */
export interface ParseRestResult {
  extraEntities: EntityDoc[]
  extraEdges: EdgeDoc[]
}

export interface ParseRestLightResult {
  entityCount: number
  edgeCount: number
  fileCount: number
  functionCount: number
  classCount: number
}

/**
 * Parse uncovered files, write entities/edges directly to ArangoDB,
 * and return only lightweight metadata. Large payloads never leave the worker.
 */
export async function parseRest(input: ParseRestInput): Promise<ParseRestLightResult> {
  const log = logger.child({ service: "indexing-heavy", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "indexing")
  log.info("Parsing uncovered files", { coveredFileCount: input.coveredFiles.length })
  plog.log("info", "Step 3/7", "Parsing remaining files with tree-sitter fallback...")
  await initializeRegistry()

  const files = await scanWorkspace(input.workspacePath)
  const coveredSet = new Set(input.coveredFiles)
  const allEntities: ParsedEntity[] = []
  const allEdges: ParsedEdge[] = []

  heartbeat("parsing uncovered files")

  for (const file of files) {
    const fileEntity = createFileEntity(input.repoId, file.relativePath)
    allEntities.push(fileEntity)
  }

  const uncoveredFiles = files.filter((f) => !coveredSet.has(f.relativePath))
  let processed = 0

  // K-05: Maximum file size for tree-sitter parsing (1 MB)
  const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024

  for (const file of uncoveredFiles) {
    const plugin = getPluginForExtension(file.extension)
    if (!plugin) continue

    try {
      // K-05: Skip files that exceed the size limit to prevent OOM
      const fileStat = statSync(file.absolutePath)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        log.warn("Skipping oversized file", {
          filePath: file.relativePath,
          sizeBytes: fileStat.size,
          maxBytes: MAX_FILE_SIZE_BYTES,
        })
        continue
      }

      // K-07: Encoding-aware file reading — detect Latin-1/CP-1252, skip binary files
      const fileResult = readFileWithEncoding(file.absolutePath)
      if (!fileResult) {
        log.debug("Skipping binary file", { filePath: file.relativePath })
        continue
      }
      if (fileResult.encoding !== "utf-8") {
        log.info("Non-UTF-8 file detected", { filePath: file.relativePath, encoding: fileResult.encoding })
      }
      const result = await plugin.parseWithTreeSitter({
        filePath: file.relativePath,
        content: fileResult.content,
        orgId: input.orgId,
        repoId: input.repoId,
      })
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)

      const fileId = entityHash(input.repoId, file.relativePath, "file", file.relativePath)
      for (const entity of result.entities) {
        allEdges.push({ from_id: fileId, to_id: entity.id, kind: "contains" })
      }
    } catch (error: unknown) {
      log.warn(`Failed to parse ${file.relativePath}`, { filePath: file.relativePath, errorMessage: error instanceof Error ? error.message : String(error) })
    }

    processed++
    if (processed % 100 === 0) {
      heartbeat(`parsed ${processed}/${uncoveredFiles.length} files`)
    }
  }

  // L-02: Resolve cross-file call edges using import metadata
  heartbeat("resolving cross-file call edges")
  const crossFileEdges = resolveCrossFileCalls(allEntities, allEdges, input.repoId)
  allEdges.push(...crossFileEdges)
  log.info("Cross-file call edges resolved", { count: crossFileEdges.length })

  // Write directly to ArangoDB — no large payloads cross Temporal
  heartbeat("writing parse results to graph store")
  const container = getContainer()
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    toEntityDocs(allEntities, input.orgId, input.repoId),
    toEdgeDocs(allEdges, input.orgId, input.repoId),
    input.indexVersion,
  )

  log.info("File parsing complete", { entityCount: writeResult.entitiesWritten, edgeCount: writeResult.edgesWritten, uncoveredFiles: uncoveredFiles.length })
  plog.log("info", "Step 3/7", `Parsing complete — wrote ${writeResult.entitiesWritten} entities from ${uncoveredFiles.length} uncovered files (${writeResult.fileCount} files, ${writeResult.functionCount} functions, ${writeResult.classCount} classes)`)
  return {
    entityCount: writeResult.entitiesWritten,
    edgeCount: writeResult.edgesWritten,
    fileCount: writeResult.fileCount,
    functionCount: writeResult.functionCount,
    classCount: writeResult.classCount,
  }
}

/**
 * Fill body for entities that have start_line/end_line but no body.
 * Reads source files from disk and extracts the relevant lines.
 * Used as a post-pass for SCIP-extracted entities.
 */
function fillBodiesFromSource(entities: ParsedEntity[], workspacePath: string): void {
  // Group entities by file_path to avoid reading the same file multiple times
  const byFile = new Map<string, ParsedEntity[]>()
  for (const entity of entities) {
    if (entity.body || !entity.start_line || !entity.file_path) continue
    const existing = byFile.get(entity.file_path)
    if (existing) {
      existing.push(entity)
    } else {
      byFile.set(entity.file_path, [entity])
    }
  }

  byFile.forEach((fileEntities, filePath) => {
    try {
      // K-07: Encoding-aware file reading
      const fileResult = readFileWithEncoding(join(workspacePath, filePath))
      if (!fileResult) return // Binary file — skip
      const lines = fileResult.content.split("\n")

      for (const entity of fileEntities) {
        const startIdx = (entity.start_line ?? 1) - 1
        const endIdx = entity.end_line ? entity.end_line - 1 : startIdx
        const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
        if (bodyLines.length > 0) {
          entity.body = bodyLines.join("\n")
        }
        // Extract doc comment if not already set
        if (!entity.doc) {
          entity.doc = extractDocComment(lines, startIdx, entity.language)
        }
      }
    } catch {
      // File might not exist on disk (generated files, etc.) — skip silently
    }
  })
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
    body: e.body,
    is_async: e.is_async,
    parameter_count: e.parameter_count,
    return_type: e.return_type,
    complexity: e.complexity,
  }))
}

/** Convert ParsedEdge[] to EdgeDoc[] (domain type → port type) */
function toEdgeDocs(edges: ParsedEdge[], orgId: string, repoId: string): EdgeDoc[] {
  return edges.map((e) => {
    const { from_id, to_id, kind, ...metadata } = e
    return {
      _from: from_id,
      _to: to_id,
      org_id: orgId,
      repo_id: repoId,
      kind,
      ...metadata,
    }
  })
}
