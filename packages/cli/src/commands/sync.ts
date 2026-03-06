/**
 * unerr sync — Push workspace state to the Unerr server using isomorphic-git.
 *
 * Phase 13 (B-02, B-03): Replaces the old zip-upload and MCP-based watch flow
 * with proper Git push via the API proxy route.
 *
 * Uses a SEPARATE gitdir (.unerr/git/) — never touches the user's .git directory.
 *
 * Flow:
 *   1. Collect all tracked files (respects .gitignore + .unerrignore)
 *   2. Stage changed files via isomorphic-git
 *   3. Commit as workspace snapshot
 *   4. Push to Unerr API proxy → Gitea (internal)
 *      ref: refs/unerr/ws/{keyId}
 *
 * --watch: chokidar file watcher → debounce 2s → repeat
 */

import { Command } from "commander"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import git from "isomorphic-git"
import fs from "node:fs"

import type { HttpClient } from "isomorphic-git"

import { getCredentials } from "./auth.js"
import { createIgnoreFilter } from "../ignore.js"

/** Lazy-load isomorphic-git's Node HTTP client. */
let _httpClient: HttpClient | null = null
function getHttpClient(): HttpClient {
  if (!_httpClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _httpClient = require("isomorphic-git/http/node") as HttpClient
  }
  return _httpClient
}

interface ProjectConfig {
  repoId: string
  serverUrl: string
  orgId: string
  branch?: string
}

function loadProjectConfig(cwd: string): ProjectConfig | null {
  const configPath = join(cwd, ".unerr", "config.json")
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ProjectConfig
  } catch {
    return null
  }
}

/** Derive a stable short ID from the API key for use in workspace ref names. */
function deriveKeyId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12)
}

/** Collect all files that should be synced (respects ignore rules). */
async function collectSyncFiles(cwd: string): Promise<string[]> {
  const ignore = await createIgnoreFilter(cwd)
  const files: string[] = []

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relPath = relative(cwd, fullPath)

      // Skip .unerr directory itself and .git
      if (entry.name === ".unerr" || entry.name === ".git") continue
      if (ignore.ignores(relPath)) continue

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        files.push(relPath)
      }
    }
  }

  walk(cwd)
  return files
}

/** Initialize the .unerr/git directory as a bare-ish git repo for isomorphic-git. */
async function ensureGitDir(cwd: string, serverUrl: string, orgId: string, repoId: string): Promise<string> {
  const gitdir = join(cwd, ".unerr", "git")

  if (!existsSync(join(gitdir, "HEAD"))) {
    mkdirSync(gitdir, { recursive: true })
    await git.init({ fs, dir: cwd, gitdir })

    // Set the remote to the API proxy
    const remoteUrl = `${serverUrl}/api/git/${orgId}/${repoId}`
    await git.addRemote({ fs, dir: cwd, gitdir, remote: "origin", url: remoteUrl })
  }

  return gitdir
}

/** Run a single sync cycle: stage → commit → push. Returns true if changes were pushed. */
async function runSync(
  cwd: string,
  gitdir: string,
  apiKey: string,
  keyId: string,
  verbose: boolean,
): Promise<boolean> {
  const files = await collectSyncFiles(cwd)
  if (files.length === 0) {
    if (verbose) console.log("  No files to sync")
    return false
  }

  // Stage all files — isomorphic-git needs us to add each file
  if (verbose) console.log(`  Staging ${files.length} files...`)
  for (const filepath of files) {
    try {
      await git.add({ fs, dir: cwd, gitdir, filepath })
    } catch {
      // File may have been deleted between collect and add — skip
    }
  }

  // Check for actual changes via statusMatrix
  const matrix = await git.statusMatrix({ fs, dir: cwd, gitdir })
  const changed = matrix.filter(([, head, workdir, stage]) => {
    // [filepath, HEAD, WORKDIR, STAGE]
    // Changed if any column differs: new files (0,2,2), modified (1,2,2), etc.
    return head !== workdir || head !== stage
  })

  if (changed.length === 0) {
    if (verbose) console.log("  No changes detected")
    return false
  }

  // Re-stage only changed files to catch deletions
  for (const [filepath, head, , ] of changed) {
    try {
      if (head === 0) {
        // New file — already staged above
      } else {
        // Modified or deleted — re-add to ensure stage is current
        const fullPath = join(cwd, filepath as string)
        if (existsSync(fullPath)) {
          await git.add({ fs, dir: cwd, gitdir, filepath: filepath as string })
        } else {
          await git.remove({ fs, dir: cwd, gitdir, filepath: filepath as string })
        }
      }
    } catch {
      // Non-critical — skip
    }
  }

  // Commit
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const sha = await git.commit({
    fs,
    dir: cwd,
    gitdir,
    message: `workspace sync ${timestamp}`,
    author: { name: "unerr-cli", email: "cli@unerr.dev" },
  })
  if (verbose) console.log(`  Committed ${sha.slice(0, 8)} (${changed.length} changes)`)

  // Push to workspace ref
  const ref = `refs/unerr/ws/${keyId}`
  try {
    const pushResult = await git.push({
      fs,
      http: getHttpClient(),
      dir: cwd,
      gitdir,
      remote: "origin",
      ref: `HEAD:${ref}`,
      force: true,
      onAuth: () => ({ username: "x-token", password: apiKey }),
      onProgress: verbose
        ? (progress) => {
            if (progress.phase && progress.total) {
              process.stdout.write(`\r  ${progress.phase}: ${progress.loaded}/${progress.total}`)
            }
          }
        : undefined,
    })
    if (verbose && changed.length > 50) process.stdout.write("\n")

    if (pushResult.ok) {
      console.log(`  Pushed ${sha.slice(0, 8)} → ${ref} (${changed.length} files changed)`)
    } else {
      const errors = pushResult.refs
        ? Object.entries(pushResult.refs).filter(([, v]) => v && typeof v === "object" && "error" in v)
        : []
      if (errors.length > 0) {
        console.error("  Push failed:", JSON.stringify(errors))
        return false
      }
      console.log(`  Pushed ${sha.slice(0, 8)} → ${ref}`)
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      console.error("  Authentication failed. Run `unerr auth login` to re-authenticate.")
    } else {
      console.error(`  Push failed: ${msg}`)
    }
    return false
  }

  return true
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Sync workspace to unerr server")
    .option("-w, --watch", "Watch for changes and sync continuously")
    .option("-v, --verbose", "Show detailed output")
    .action(async (opts: { watch?: boolean; verbose?: boolean }) => {
      const cwd = process.cwd()
      const config = loadProjectConfig(cwd)
      if (!config) {
        console.error("No .unerr/config.json found. Run `unerr init` first.")
        process.exit(1)
      }

      const creds = getCredentials()
      if (!creds) {
        console.error("Not authenticated. Run `unerr auth login` first.")
        process.exit(1)
      }

      const serverUrl = config.serverUrl || creds.serverUrl
      const apiKey = creds.apiKey
      const keyId = deriveKeyId(apiKey)

      // Initialize .unerr/git
      const gitdir = await ensureGitDir(cwd, serverUrl, config.orgId, config.repoId)

      if (opts.watch) {
        await runWatchMode(cwd, gitdir, apiKey, keyId, opts.verbose ?? false)
      } else {
        // Single sync
        console.log("Syncing workspace...")
        const pushed = await runSync(cwd, gitdir, apiKey, keyId, opts.verbose ?? false)
        if (!pushed) {
          console.log("Workspace is up to date.")
        }
      }
    })
}

/**
 * B-03: Watch mode — chokidar + debounce 2s + continuous push.
 */
async function runWatchMode(
  cwd: string,
  gitdir: string,
  apiKey: string,
  keyId: string,
  verbose: boolean,
): Promise<void> {
  const chokidar = await import("chokidar")
  const ignore = await createIgnoreFilter(cwd)

  console.log("Watching for changes... (Ctrl+C to stop)")

  // Initial sync
  await runSync(cwd, gitdir, apiKey, keyId, verbose)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let syncInProgress = false
  let pendingSync = false

  const triggerSync = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      if (syncInProgress) {
        pendingSync = true
        return
      }
      syncInProgress = true
      try {
        await runSync(cwd, gitdir, apiKey, keyId, verbose)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`  Sync error: ${msg}`)
      } finally {
        syncInProgress = false
        if (pendingSync) {
          pendingSync = false
          triggerSync()
        }
      }
    }, 2000)
  }

  const watcher = chokidar.watch(cwd, {
    ignored: (filePath: string) => {
      const rel = relative(cwd, filePath)
      if (!rel || rel === ".") return false
      if (rel.startsWith(".unerr") || rel.startsWith(".git")) return true
      return ignore.ignores(rel)
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  })

  watcher.on("add", triggerSync)
  watcher.on("change", triggerSync)
  watcher.on("unlink", triggerSync)

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nStopping watch mode...")
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher.close()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Keep alive
  await new Promise(() => {})
}
