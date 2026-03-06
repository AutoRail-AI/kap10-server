import { heartbeat } from "@temporalio/activity"
import { execFile } from "node:child_process"
import { existsSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

import { getContainer } from "@/lib/di/container"
import { resolveCrossFileCalls } from "@/lib/indexer/cross-file-calls"
import { loadIgnoreFilter } from "@/lib/indexer/ignore"
import { extractDocComment } from "@/lib/indexer/doc-extractor"
import { entityHash } from "@/lib/indexer/entity-hash"
import { readFileWithEncoding } from "@/lib/indexer/file-reader"
import { createFileEntity } from "@/lib/indexer/languages/generic"
import { getPluginForExtension, getPluginsForExtensions, initializeRegistry } from "@/lib/indexer/languages/registry"
import { detectLanguagePerRoot, detectPackageRoots } from "@/lib/indexer/monorepo"
import { detectLanguages, scanIndexDir } from "@/lib/indexer/scanner"
import type { ParsedEdge, ParsedEntity } from "@/lib/indexer/types"
import { MAX_BODY_LINES } from "@/lib/indexer/types"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { writeEntitiesToGraph } from "@/lib/temporal/activities/graph-writer"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

export interface PrepareRepoIntelligenceSpaceInput extends PipelineContext {
  /** Phase 13: Resolved commit SHA from ingestSource */
  commitSha?: string
  /** Phase 13: Git ref (e.g., "refs/heads/main") */
  ref?: string
  defaultBranch: string
  provider?: "github" | "local_cli"
  /** @deprecated Phase 13 — only used as fallback when commitSha is not provided */
  installationId?: number
  /** @deprecated Phase 13 — only used as fallback when commitSha is not provided */
  cloneUrl?: string
  /** @deprecated Phase 13 — only used as fallback when commitSha is not provided */
  uploadPath?: string
}

export interface PrepareRepoIntelligenceSpaceResult {
  indexDir: string
  languages: string[]
  packageRoots: string[]
  /** A-05: Dominant language per package root for polyglot SCIP indexing */
  languagePerRoot?: Record<string, string>
  lastSha?: string
  /** Phase 13: true if this used worktree-based checkout (needs removeWorktree in finally) */
  isWorktree: boolean
}

/**
 * Phase 13: Worktree-based repo preparation.
 *
 * When commitSha is provided (from ingestSource), creates a git worktree from the
 * bare clone on the shared Gitea volume. Zero network I/O — purely local filesystem.
 *
 * CRITICAL: If isWorktree=true in the result, the caller MUST call removeWorktree()
 * in a finally block. The workflow enforces this — see indexRepoWorkflow.
 */
export async function prepareRepoIntelligenceSpace(input: PrepareRepoIntelligenceSpaceInput): Promise<PrepareRepoIntelligenceSpaceResult> {
  const log = logger.child({ service: "indexing-heavy", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "indexing")
  const activityStart = Date.now()
  const container = getContainer()

  // Phase 13: Worktree-based checkout when commitSha is available
  if (input.commitSha) {
    const ref = input.ref ?? input.commitSha
    log.info("Creating worktree from bare clone", { commitSha: input.commitSha, ref })
    plog.log("info", "Step 1/7", `Creating worktree at ${input.commitSha.slice(0, 8)}...`)

    const worktreeStart = Date.now()
    const handle = await container.internalGitServer.createWorktree(
      input.orgId, input.repoId, input.commitSha
    )
    const worktreeMs = Date.now() - worktreeStart
    log.info("Worktree created", { path: handle.path, commitSha: handle.commitSha, durationMs: worktreeMs })

    heartbeat("scanning worktree")

    const scanStart = Date.now()
    const files = await scanIndexDir(handle.path)
    const languageStats = detectLanguages(files)
    const languages = languageStats.map((l) => l.language)
    const scanMs = Date.now() - scanStart

    const indexInfo = detectPackageRoots(handle.path)
    const packageRoots = indexInfo.roots
    const languagePerRoot = packageRoots.length > 1
      ? detectLanguagePerRoot(handle.path, packageRoots)
      : undefined

    const totalMs = Date.now() - activityStart
    log.info("Worktree index dir prepared", {
      indexDir: handle.path, languages, lastSha: handle.commitSha,
      fileCount: files.length, rootCount: packageRoots.length,
      timing: { worktreeMs, scanMs, totalMs },
    })
    plog.log("info", "Step 1/7", `Worktree ready — ${files.length} files, ${languages.length} languages [${languages.join(", ") || "none"}], ${packageRoots.length} roots | Worktree: ${worktreeMs}ms, Scan: ${scanMs}ms, Total: ${totalMs}ms`)
    return { indexDir: handle.path, languages, packageRoots, languagePerRoot, lastSha: handle.commitSha, isWorktree: true }
  }

  // Legacy fallback: git clone (for repos not yet on Gitea)
  const provider = input.provider ?? "github"
  log.info("Preparing repo index directory (legacy clone)", { cloneUrl: input.cloneUrl, defaultBranch: input.defaultBranch, provider })
  plog.log("info", "Step 1/7", `Cloning repository (${provider}) — legacy path...`)
  const indexDir = `/data/repo-indices/${input.orgId}/${input.repoId}`

  if (existsSync(indexDir)) {
    rmSync(indexDir, { recursive: true, force: true })
    log.info("Removed stale clone dir for fresh clone", { indexDir })
  }

  const cloneStart = Date.now()
  if (provider === "local_cli" && input.uploadPath) {
    await prepareLocalCliIndexDir(container, indexDir, input.uploadPath)
  } else if (input.cloneUrl) {
    await container.gitHost.cloneRepo(input.cloneUrl, indexDir, {
      ref: input.defaultBranch,
      installationId: input.installationId ?? 0,
    })
  } else {
    throw new Error("[prepareRepoIntelligenceSpace] Neither commitSha nor cloneUrl provided")
  }
  const cloneMs = Date.now() - cloneStart

  heartbeat("index dir ready, reading HEAD SHA")

  let lastSha: string | undefined
  if (provider !== "local_cli") {
    try {
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
      lastSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: indexDir, encoding: "utf-8" }).trim()
    } catch (error: unknown) {
      log.warn("Failed to read HEAD SHA", { errorMessage: error instanceof Error ? error.message : String(error) })
    }
  }

  heartbeat("scanning index dir")

  const scanStart = Date.now()
  const files = await scanIndexDir(indexDir)
  const languageStats = detectLanguages(files)
  const languages = languageStats.map((l) => l.language)
  const scanMs = Date.now() - scanStart

  const indexInfo = detectPackageRoots(indexDir)
  const packageRoots = indexInfo.roots
  const languagePerRoot = packageRoots.length > 1
    ? detectLanguagePerRoot(indexDir, packageRoots)
    : undefined

  const totalMs = Date.now() - activityStart
  log.info("Repo index dir prepared (legacy)", {
    indexDir, languages, lastSha, fileCount: files.length,
    rootCount: packageRoots.length, timing: { cloneMs, scanMs, totalMs },
  })
  plog.log("info", "Step 1/7", `Index dir ready — ${files.length} files, ${languages.length} languages [${languages.join(", ") || "none"}], ${packageRoots.length} roots | Clone: ${cloneMs}ms, Scan: ${scanMs}ms, Total: ${totalMs}ms`)
  return { indexDir, languages, packageRoots, languagePerRoot, lastSha, isWorktree: false }
}

/**
 * @deprecated Legacy path — download a zip from Supabase Storage and extract it.
 * Used for local_cli repos uploaded via `unerr push` (pre-Phase 13).
 */
async function prepareLocalCliIndexDir(
  container: { storageProvider: import("@/lib/ports/storage-provider").IStorageProvider },
  indexDir: string,
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
    mkdirSync(indexDir, { recursive: true })
    const zipPath = `${indexDir}/../upload.zip`
    writeFileSync(zipPath, zipBuffer)
    execSync(`unzip -o "${zipPath}" -d "${indexDir}"`, { stdio: "pipe" })

    const { unlinkSync } = require("node:fs") as typeof import("node:fs")
    try { unlinkSync(zipPath) } catch { /* Non-critical */ }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[prepareRepoIntelligenceSpace] Failed to extract local_cli upload: ${message}`)
  }
}

export interface RunSCIPInput extends PipelineContext {
  indexDir: string
  languages: string[]
  packageRoots: string[]
  indexVersion?: string
  /** Phase 13: scope + commitSha stamped on entities written to ArangoDB */
  scope?: string
  commitSha?: string | null
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
  const plog = pipelineLogger(input, "indexing")
  log.info("Starting SCIP indexers", { languages: input.languages })
  plog.log("info", "Step 2/7", `Running SCIP indexers for: ${input.languages.join(", ")}`)

  // K-03: Pre-check SCIP binary availability and surface to pipeline log
  const scipBinaries: Record<string, string> = {
    typescript: "npx", // scip-typescript runs via npx
    python: "scip-python",
    go: "scip-go",
    java: "scip-java",
    c: "scip-clang",
    cpp: "scip-clang",
    csharp: "scip-dotnet",
    rust: "scip-rust",
    ruby: "scip-ruby",
    php: "scip-php",
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

  const files = await scanIndexDir(input.indexDir)
  const extensions = Array.from(new Set(files.map((f) => f.extension)))
  const plugins = getPluginsForExtensions(extensions)

  heartbeat("starting SCIP indexers")

  const isIncluded = loadIgnoreFilter(input.indexDir)

  const activityStart = Date.now()
  const pluginTimings: Record<string, { ms: number; entities: number; edges: number; files: number }> = {}

  log.info("SCIP plugins resolved", { pluginIds: plugins.map((p) => p.id), packageRoots: input.packageRoots })
  for (const plugin of plugins) {
    try {
      heartbeat(`running SCIP for ${plugin.id}`)
      const pluginStart = Date.now()
      const result = await plugin.runSCIP({
        indexDir: input.indexDir,
        packageRoots: input.packageRoots,
        orgId: input.orgId,
        repoId: input.repoId,
        isIncluded,
      })
      const pluginMs = Date.now() - pluginStart

      // Count entity kinds for this plugin
      const kindCounts: Record<string, number> = {}
      for (const e of result.entities) {
        kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1
      }

      pluginTimings[plugin.id] = { ms: pluginMs, entities: result.entities.length, edges: result.edges.length, files: result.coveredFiles.length }
      log.info(`SCIP plugin ${plugin.id} complete`, {
        pluginId: plugin.id,
        entities: result.entities.length,
        edges: result.edges.length,
        coveredFiles: result.coveredFiles.length,
        kindCounts,
        durationMs: pluginMs,
      })
      plog.log("info", "Step 2/7", `SCIP ${plugin.id}: ${result.entities.length} entities, ${result.edges.length} edges, ${result.coveredFiles.length} files (${pluginMs}ms)`, { pluginId: plugin.id, ...kindCounts })
      if (result.coveredFiles.length === 0) {
        plog.log("warn", "Step 2/7", `SCIP indexer for ${plugin.id} produced 0 covered files — project markers may be missing (tsconfig.json, go.mod, etc.)`)
      }
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.warn(`SCIP plugin ${plugin.id} failed`, { pluginId: plugin.id, errorMessage })
      plog.log("warn", "Step 2/7", `SCIP indexer for ${plugin.id} failed: ${errorMessage}. Falling back to tree-sitter.`)
    }
  }

  heartbeat("filling source bodies for SCIP entities")
  const fillStart = Date.now()
  fillBodiesFromSource(allEntities, input.indexDir)
  const fillMs = Date.now() - fillStart
  const bodiesFilled = allEntities.filter((e) => e.body).length
  log.info("Source bodies filled", { totalEntities: allEntities.length, bodiesFilled, durationMs: fillMs })

  // Write directly to ArangoDB — no large payloads cross Temporal
  heartbeat("writing SCIP results to graph store")
  const writeStart = Date.now()
  const container = getContainer()
  // Phase 13: Pass scope info so entities are stamped with scope + commit_sha
  const scopeInfo = input.scope ? { scope: input.scope, commitSha: input.commitSha ?? null } : undefined
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    toEntityDocs(allEntities, input.orgId, input.repoId),
    toEdgeDocs(allEdges, input.orgId, input.repoId),
    input.indexVersion,
    scopeInfo,
  )
  const writeMs = Date.now() - writeStart

  const totalMs = Date.now() - activityStart
  log.info("SCIP indexing complete", {
    entityCount: writeResult.entitiesWritten, edgeCount: writeResult.edgesWritten,
    coveredFiles: allCoveredFiles.length,
    timing: { totalMs, fillMs, writeMs, plugins: pluginTimings },
  })
  plog.log("info", "Step 2/7", `SCIP complete — ${writeResult.entitiesWritten} entities, ${writeResult.edgesWritten} edges (${writeResult.fileCount} files, ${writeResult.functionCount} functions, ${writeResult.classCount} classes) | Fill: ${fillMs}ms, Write: ${writeMs}ms, Total: ${totalMs}ms`, { pluginTimings })
  return {
    entityCount: writeResult.entitiesWritten,
    edgeCount: writeResult.edgesWritten,
    coveredFiles: allCoveredFiles,
    fileCount: writeResult.fileCount,
    functionCount: writeResult.functionCount,
    classCount: writeResult.classCount,
  }
}

export interface ParseRestInput extends PipelineContext {
  indexDir: string
  coveredFiles: string[]
  indexVersion?: string
  /** Phase 13: scope + commitSha stamped on entities written to ArangoDB */
  scope?: string
  commitSha?: string | null
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
  const plog = pipelineLogger(input, "indexing")
  const activityStart = Date.now()
  log.info("Parsing uncovered files", { coveredFileCount: input.coveredFiles.length })
  plog.log("info", "Step 3/7", "Parsing remaining files with tree-sitter fallback...")
  await initializeRegistry()

  const files = await scanIndexDir(input.indexDir)
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
  let skippedOversized = 0
  let skippedBinary = 0
  let parseFailed = 0

  // K-05: Maximum file size for tree-sitter parsing (1 MB)
  const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024

  log.info("Tree-sitter parse plan", {
    totalFiles: files.length,
    coveredBySCIP: input.coveredFiles.length,
    uncoveredFiles: uncoveredFiles.length,
    fileEntitiesCreated: files.length,
  })
  plog.log("info", "Step 3/7", `${files.length} total files, ${input.coveredFiles.length} covered by SCIP, ${uncoveredFiles.length} need tree-sitter parsing`)

  const parseStart = Date.now()
  for (const file of uncoveredFiles) {
    const plugin = getPluginForExtension(file.extension)
    if (!plugin) continue

    try {
      const fileStat = statSync(file.absolutePath)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        skippedOversized++
        continue
      }

      const fileResult = readFileWithEncoding(file.absolutePath)
      if (!fileResult) {
        skippedBinary++
        continue
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
      parseFailed++
      log.warn(`Failed to parse ${file.relativePath}`, { filePath: file.relativePath, errorMessage: error instanceof Error ? error.message : String(error) })
    }

    processed++
    if (processed % 100 === 0) {
      heartbeat(`parsed ${processed}/${uncoveredFiles.length} files`)
    }
  }
  const parseMs = Date.now() - parseStart

  if (skippedOversized > 0 || skippedBinary > 0 || parseFailed > 0) {
    log.info("Tree-sitter skip summary", { skippedOversized, skippedBinary, parseFailed, processed })
    plog.log("info", "Step 3/7", `Parsed ${processed} files (skipped: ${skippedOversized} oversized, ${skippedBinary} binary, ${parseFailed} failed)`)
  }

  // L-02: Resolve cross-file call edges using import metadata
  heartbeat("resolving cross-file call edges")
  const crossFileStart = Date.now()
  const crossFileEdges = resolveCrossFileCalls(allEntities, allEdges, input.repoId)
  allEdges.push(...crossFileEdges)
  const crossFileMs = Date.now() - crossFileStart
  log.info("Cross-file call edges resolved", { count: crossFileEdges.length, durationMs: crossFileMs })

  // Write directly to ArangoDB — no large payloads cross Temporal
  heartbeat("writing parse results to graph store")
  const writeStart = Date.now()
  const container = getContainer()
  // Phase 13: Pass scope info so entities are stamped with scope + commit_sha
  const parseScopeInfo = input.scope ? { scope: input.scope, commitSha: input.commitSha ?? null } : undefined
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    toEntityDocs(allEntities, input.orgId, input.repoId),
    toEdgeDocs(allEdges, input.orgId, input.repoId),
    input.indexVersion,
    parseScopeInfo,
  )
  const writeMs = Date.now() - writeStart

  const totalMs = Date.now() - activityStart
  log.info("File parsing complete", {
    entityCount: writeResult.entitiesWritten, edgeCount: writeResult.edgesWritten,
    uncoveredFiles: uncoveredFiles.length,
    skippedOversized, skippedBinary, parseFailed,
    crossFileEdges: crossFileEdges.length,
    timing: { parseMs, crossFileMs, writeMs, totalMs },
  })
  plog.log("info", "Step 3/7", `Parsing complete — ${writeResult.entitiesWritten} entities, ${writeResult.edgesWritten} edges (${writeResult.fileCount} files, ${writeResult.functionCount} functions, ${writeResult.classCount} classes) | Parse: ${parseMs}ms, CrossFile: ${crossFileMs}ms, Write: ${writeMs}ms, Total: ${totalMs}ms`)
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
function fillBodiesFromSource(entities: ParsedEntity[], indexDir: string): void {
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
      const fileResult = readFileWithEncoding(join(indexDir, filePath))
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
    cognitive_complexity: e.cognitive_complexity,
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
