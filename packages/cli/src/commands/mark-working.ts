/**
 * kap10 mark-working — Mark a ledger entry as a known-good working state.
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

export function registerMarkWorkingCommand(program: Command): void {
  program
    .command("mark-working <entry-id>")
    .description("Mark a ledger entry as a known-good working state")
    .action(async (entryId: string) => {
      try {
        const config = loadConfig()
        if (!config) { console.error("Not initialized. Run: kap10 init"); process.exit(1) }
        const creds = getCredentials()
        if (!creds?.apiKey) { console.error("Not authenticated. Run: kap10 auth login"); process.exit(1) }

        const res = await fetch(
          `${config.serverUrl}/api/repos/${config.repoId}/timeline/mark-working`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${creds.apiKey}`,
            },
            body: JSON.stringify({ entryId, files: [] }),
          }
        )

        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          console.error(`Failed: ${body.error ?? res.statusText}`)
          process.exit(1)
        }

        const data = (await res.json()) as { snapshotId: string }
        console.log(`Marked entry ${entryId} as working`)
        console.log(`  Snapshot: ${data.snapshotId}`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
