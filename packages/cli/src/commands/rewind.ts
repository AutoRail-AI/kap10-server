/**
 * unerr rewind — Revert ledger to a previous working state.
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

export function registerRewindCommand(program: Command): void {
  program
    .command("rewind <entry-id>")
    .description("Rewind to a previous working state")
    .option("--dry-run", "Only show blast radius without making changes")
    .action(async (entryId: string, opts: { dryRun?: boolean }) => {
      try {
        const config = loadConfig()
        if (!config) { console.error("Not initialized. Run: unerr init"); process.exit(1) }
        const creds = getCredentials()
        if (!creds?.apiKey) { console.error("Not authenticated. Run: unerr auth login"); process.exit(1) }

        const res = await fetch(`${config.serverUrl}/api/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`,
          },
          body: JSON.stringify({
            method: "tools/call",
            params: {
              name: "revert_to_working_state",
              arguments: { target_entry_id: entryId, dry_run: opts.dryRun ?? false },
            },
          }),
        })

        const result = (await res.json()) as { content?: Array<{ text: string }> }
        const text = result.content?.[0]?.text
        if (!text) { console.error("Unexpected response"); process.exit(1) }

        const data = JSON.parse(text) as Record<string, unknown>

        if (opts.dryRun) {
          console.log("\nDry Run — Blast Radius:")
          const br = data.blastRadius as { safeFiles?: string[]; conflictedFiles?: Array<{ filePath: string }>; manualChangesAtRisk?: Array<{ filePath: string }> }
          console.log(`  Safe files: ${(br.safeFiles ?? []).length}`)
          console.log(`  Conflicted: ${(br.conflictedFiles ?? []).length}`)
          console.log(`  At risk: ${(br.manualChangesAtRisk ?? []).length}`)
          if ((br.conflictedFiles ?? []).length > 0) {
            console.log("\n  Conflicted files:")
            for (const f of br.conflictedFiles ?? []) {
              console.log(`    - ${f.filePath}`)
            }
          }
        } else {
          console.log(`Reverted to entry ${entryId}`)
          console.log(`  Timeline branch: ${data.timelineBranch}`)
          console.log(`  Entries reverted: ${data.entriesReverted}`)
          console.log(`  Rewind entry: ${data.rewindEntryId}`)
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
