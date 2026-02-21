/**
 * kap10 timeline — Display formatted ledger timeline.
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

export function registerTimelineCommand(program: Command): void {
  program
    .command("timeline")
    .description("Show the prompt ledger timeline")
    .option("--branch <branch>", "Filter by branch")
    .option("--status <status>", "Filter by status (pending|working|broken|committed|reverted)")
    .option("--limit <n>", "Number of entries to show", "20")
    .action(async (opts: { branch?: string; status?: string; limit: string }) => {
      try {
        const config = loadConfig()
        if (!config) { console.error("Not initialized. Run: kap10 init"); process.exit(1) }
        const creds = getCredentials()
        if (!creds?.apiKey) { console.error("Not authenticated. Run: kap10 auth login"); process.exit(1) }

        const params = new URLSearchParams()
        if (opts.branch) params.set("branch", opts.branch)
        if (opts.status) params.set("status", opts.status)
        params.set("limit", opts.limit)

        const res = await fetch(
          `${config.serverUrl}/api/repos/${config.repoId}/timeline?${params.toString()}`,
          { headers: { Authorization: `Bearer ${creds.apiKey}` } }
        )

        if (!res.ok) { console.error(`Failed: ${res.statusText}`); process.exit(1) }

        const data = (await res.json()) as {
          items: Array<{
            id: string; status: string; prompt: string; branch: string
            timeline_branch: number; agent_model?: string; created_at: string
            changes: Array<unknown>
          }>
          hasMore: boolean
        }

        if (data.items.length === 0) {
          console.log("No ledger entries found.")
          return
        }

        const STATUS_ICONS: Record<string, string> = {
          working: "●", broken: "✗", pending: "○", committed: "◆", reverted: "↩",
        }

        console.log("\n  ID                                   Status     Branch        Prompt")
        console.log("  " + "─".repeat(90))

        for (const entry of data.items) {
          const icon = STATUS_ICONS[entry.status] ?? "?"
          const prompt = entry.prompt.slice(0, 40).padEnd(40)
          const status = `${icon} ${entry.status}`.padEnd(12)
          const branch = `${entry.branch}#${entry.timeline_branch}`.padEnd(14)
          console.log(`  ${entry.id.slice(0, 36)}   ${status} ${branch} ${prompt}`)
        }

        if (data.hasMore) {
          console.log(`\n  ... more entries available (use --limit to see more)`)
        }
        console.log()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
