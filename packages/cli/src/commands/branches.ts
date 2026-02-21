/**
 * kap10 branches — Show timeline branches.
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

export function registerBranchesCommand(program: Command): void {
  program
    .command("branches")
    .description("Show timeline branches for this repository")
    .action(async () => {
      try {
        const config = loadConfig()
        if (!config) { console.error("Not initialized. Run: kap10 init"); process.exit(1) }
        const creds = getCredentials()
        if (!creds?.apiKey) { console.error("Not authenticated. Run: kap10 auth login"); process.exit(1) }

        const res = await fetch(
          `${config.serverUrl}/api/repos/${config.repoId}/timeline?limit=200`,
          { headers: { Authorization: `Bearer ${creds.apiKey}` } }
        )

        if (!res.ok) { console.error(`Failed: ${res.statusText}`); process.exit(1) }

        const data = (await res.json()) as {
          items: Array<{ branch: string; timeline_branch: number; status: string; created_at: string }>
        }

        // Group by branch + timeline_branch
        const branches = new Map<string, { count: number; latest: string; statuses: Set<string> }>()
        for (const entry of data.items) {
          const key = `${entry.branch}#${entry.timeline_branch}`
          const existing = branches.get(key) ?? { count: 0, latest: "", statuses: new Set<string>() }
          existing.count++
          existing.statuses.add(entry.status)
          if (!existing.latest || entry.created_at > existing.latest) {
            existing.latest = entry.created_at
          }
          branches.set(key, existing)
        }

        if (branches.size === 0) {
          console.log("No timeline branches found.")
          return
        }

        console.log("\n  Branch              Entries  Statuses              Last Activity")
        console.log("  " + "─".repeat(75))
        for (const [key, info] of Array.from(branches.entries())) {
          const statuses = Array.from(info.statuses).join(", ")
          console.log(
            `  ${key.padEnd(20)} ${String(info.count).padEnd(8)} ${statuses.padEnd(22)} ${new Date(info.latest).toLocaleString()}`
          )
        }
        console.log()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
