/**
 * unerr watch — File watcher with debounced sync and drift detection.
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

function loadConfig(): { repoId: string; serverUrl: string; orgId: string } | null {
  const configPath = path.join(process.cwd(), ".unerr", "config.json")
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as { repoId: string; serverUrl: string; orgId: string }
}

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch for file changes and sync to unerr server")
    .option("--debounce <ms>", "Debounce interval in ms", "2000")
    .action(async (opts: { debounce: string }) => {
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

      const debounceMs = parseInt(opts.debounce, 10)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      const changedFiles = new Set<string>()

      console.log(`Watching for changes (debounce: ${debounceMs}ms)...`)
      console.log("Press Ctrl+C to stop.\n")

      const chokidar = await import("chokidar")

      // Load .gitignore patterns
      const ignore = (await import("ignore")).default
      const ig = ignore()
      ig.add([".git", ".unerr", "node_modules"])
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

      // P5.6-ADV-04: Config integrity check every 60s
      const configCheckInterval = setInterval(async () => {
        try {
          const configPath = path.join(process.cwd(), ".unerr", "config.json")
          if (!fs.existsSync(configPath)) return

          const unerrConfig = JSON.parse(
            fs.readFileSync(configPath, "utf-8")
          ) as { serverUrl?: string }
          const serverUrl = unerrConfig.serverUrl ?? "http://localhost:3000"

          // Quick check: verify .cursor/mcp.json or .vscode/settings.json has unerr entry
          const cwd = process.cwd()
          const ideConfigs = [
            { name: "cursor", path: path.join(cwd, ".cursor", "mcp.json"), key: "mcpServers" },
            { name: "vscode", path: path.join(cwd, ".vscode", "settings.json"), key: "mcp.servers" },
          ]

          for (const ide of ideConfigs) {
            if (!fs.existsSync(ide.path)) continue

            try {
              const raw = fs.readFileSync(ide.path, "utf-8")
              const parsed = JSON.parse(raw) as Record<string, unknown>
              const servers = (ide.key === "mcpServers"
                ? parsed.mcpServers
                : parsed["mcp.servers"]) as Record<string, unknown> | undefined

              if (servers && !servers["unerr"]) {
                console.log(
                  `[config] MCP config drift detected in ${ide.name}, auto-repairing...`
                )
                // Re-add unerr entry
                servers["unerr"] = {
                  url: `${serverUrl}/mcp`,
                  headers: {
                    Authorization: `Bearer ${creds!.apiKey}`,
                  },
                }
                if (ide.key === "mcpServers") {
                  parsed.mcpServers = servers
                } else {
                  parsed["mcp.servers"] = servers
                }
                fs.writeFileSync(ide.path, JSON.stringify(parsed, null, 2))
                console.log(`[config] Repaired ${ide.name} MCP config.`)
              }
            } catch {
              // Best effort
            }
          }
        } catch {
          // Best effort
        }
      }, 60_000)

      // Keep process alive
      process.on("SIGINT", () => {
        console.log("\nStopping watcher...")
        clearInterval(configCheckInterval)
        void watcher.close()
        process.exit(0)
      })
    })
}
