/**
 * unerr push — Bootstrap a local repository for indexing via isomorphic-git.
 *
 * Phase 13 (E-01): Replaces the old zip-upload flow with a proper Git-based
 * initial push. Uses the same isomorphic-git infrastructure as `unerr sync`.
 *
 * Flow:
 *   1. Collect all tracked files (respects .gitignore + .unerrignore)
 *   2. Initialize .unerr/git if needed, set remote to API proxy
 *   3. Stage all files → commit → push to refs/heads/main
 *   4. Call POST /api/repos to trigger indexing
 *
 * After the initial push, subsequent updates should use `unerr sync`.
 */

import { Command } from "commander"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
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

function loadConfig(): ProjectConfig | null {
  const configPath = join(process.cwd(), ".unerr", "config.json")
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ProjectConfig
  } catch {
    return null
  }
}

/** Derive a stable short ID from the API key. */
function deriveKeyId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12)
}

/** Collect all files that should be pushed (respects ignore rules). */
async function collectPushFiles(cwd: string): Promise<string[]> {
  const ignore = await createIgnoreFilter(cwd)
  const files: string[] = []

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relPath = relative(cwd, fullPath)

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

/** Initialize the .unerr/git directory for isomorphic-git. */
async function ensureGitDir(cwd: string, serverUrl: string, orgId: string, repoId: string): Promise<string> {
  const gitdir = join(cwd, ".unerr", "git")

  if (!existsSync(join(gitdir, "HEAD"))) {
    mkdirSync(gitdir, { recursive: true })
    await git.init({ fs, dir: cwd, gitdir })

    const remoteUrl = `${serverUrl}/api/git/${orgId}/${repoId}`
    await git.addRemote({ fs, dir: cwd, gitdir, remote: "origin", url: remoteUrl })
  }

  return gitdir
}

export function registerPushCommand(program: Command): void {
  program
    .command("push")
    .description("Upload local repository for indexing (initial bootstrap)")
    .action(async () => {
      try {
        const config = loadConfig()
        if (!config) {
          console.error("Not initialized. Run: unerr init")
          process.exit(1)
        }

        const creds = getCredentials()
        if (!creds?.apiKey) {
          console.error("Not authenticated. Run: unerr auth login")
          process.exit(1)
        }

        const cwd = process.cwd()
        const keyId = deriveKeyId(creds.apiKey)
        const ref = `refs/unerr/ws/${keyId}`

        console.log("Collecting files...")
        const files = await collectPushFiles(cwd)
        if (files.length === 0) {
          console.error("No files found to push. Check your .gitignore and .unerrignore.")
          process.exit(1)
        }
        console.log(`Found ${files.length} files`)

        // Initialize git dir and stage all files
        const gitdir = await ensureGitDir(cwd, config.serverUrl, config.orgId, config.repoId)

        console.log("Staging files...")
        for (const file of files) {
          await git.add({ fs, dir: cwd, gitdir, filepath: file })
        }

        // Create the initial commit
        const commitSha = await git.commit({
          fs,
          dir: cwd,
          gitdir,
          message: `Initial push via unerr push (${files.length} files)`,
          author: {
            name: "unerr",
            email: "cli@unerr.io",
          },
        })
        console.log(`Committed ${commitSha.slice(0, 8)} (${files.length} files)`)

        // Push to the API proxy
        console.log("Pushing to server...")
        const http = getHttpClient()
        await git.push({
          fs,
          http,
          dir: cwd,
          gitdir,
          remote: "origin",
          ref: "HEAD",
          remoteRef: ref,
          force: true,
          onAuth: () => ({ username: "x-token", password: creds.apiKey }),
          onProgress: (progress) => {
            if (progress.phase === "Counting objects") {
              process.stdout.write(`\r  ${progress.phase}: ${progress.loaded}`)
            } else if (progress.phase === "Compressing objects") {
              process.stdout.write(`\r  ${progress.phase}: ${progress.loaded}/${progress.total ?? "?"}`)
            } else if (progress.phase) {
              process.stdout.write(`\r  ${progress.phase}`)
            }
          },
        })
        process.stdout.write("\n")

        console.log("Push complete. Indexing will begin automatically.")
        console.log("\nFor ongoing sync, use: unerr sync")
        console.log("For continuous mode, use: unerr sync --watch")
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
