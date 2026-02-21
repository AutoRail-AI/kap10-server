/**
 * kap10 watch — File watcher with debounced sync and drift detection.
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

function loadConfig(): { repoId: string; serverUrl: string; orgId: string } | null {
  const configPath = path.join(process.cwd(), ".kap10", "config.json")
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as { repoId: string; serverUrl: string; orgId: string }
}

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch for file changes and sync to kap10 server")
    .option("--debounce <ms>", "Debounce interval in ms", "2000")
    .action(async (opts: { debounce: string }) => {
      const config = loadConfig()
      if (!config) {
        console.error("Not initialized. Run: kap10 init")
        process.exit(1)
      }

      const creds = getCredentials()
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: kap10 auth login")
        process.exit(1)
      }

      const debounceMs = parseInt(opts.debounce, 10)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      const changedFiles = new Set<string>()

      console.log(`Watching for changes (debounce: ${debounceMs}ms)...`)
      console.log("Press Ctrl+C to stop.\n")

      const chokidar = await import("chokidar")

      // Load .gitignore patterns
      const ignore = (await import("ignore")).default
      const ig = ignore()
      ig.add([".git", ".kap10", "node_modules"])
      const gitignorePath = path.join(process.cwd(), ".gitignore")
      if (fs.existsSync(gitignorePath)) {
        ig.add(fs.readFileSync(gitignorePath, "utf-8"))
      }

      const watcher = chokidar.watch(process.cwd(), {
        ignored: (filePath: string) => {
          const rel = path.relative(process.cwd(), filePath)
          if (!rel) return false
          return ig.ignores(rel)
        },
        persistent: true,
        ignoreInitial: true,
      })

      async function syncChanges() {
        if (changedFiles.size === 0) return
        const files = Array.from(changedFiles)
        changedFiles.clear()

        console.log(`Syncing ${files.length} changed file(s)...`)

        try {
          // Use git diff for the changed files
          const { execSync } = await import("node:child_process")
          const diff = execSync(
            `git diff -- ${files.map(f => `"${f}"`).join(" ")}`,
            { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 }
          )

          if (!diff.trim()) {
            console.log("  No diff to sync (changes may be staged)")
            return
          }

          const res = await fetch(`${config!.serverUrl}/api/mcp`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${creds!.apiKey}`,
            },
            body: JSON.stringify({
              method: "tools/call",
              params: {
                name: "sync_local_diff",
                arguments: { diff },
              },
            }),
          })

          if (res.ok) {
            console.log(`  Synced ${files.length} file(s)`)
          } else {
            console.error(`  Sync failed: ${res.statusText}`)
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`  Sync error: ${message}`)
        }
      }

      watcher.on("change", (filePath: string) => {
        const rel = path.relative(process.cwd(), filePath)
        changedFiles.add(rel)

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void syncChanges()
        }, debounceMs)
      })

      watcher.on("add", (filePath: string) => {
        const rel = path.relative(process.cwd(), filePath)
        changedFiles.add(rel)
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void syncChanges()
        }, debounceMs)
      })

      // Keep process alive
      process.on("SIGINT", () => {
        console.log("\nStopping watcher...")
        void watcher.close()
        process.exit(0)
      })
    })
}
