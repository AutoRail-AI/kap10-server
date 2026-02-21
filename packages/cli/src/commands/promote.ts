/**
 * kap10 promote — converts an ephemeral sandbox to a permanent repo.
 * Phase 5.6: P5.6-ADV-03
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

function loadConfig(): { repoId: string; serverUrl: string; orgId: string } | null {
  const configPath = path.join(process.cwd(), ".kap10", "config.json")
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
    repoId: string
    serverUrl: string
    orgId: string
  }
}

export function registerPromoteCommand(program: Command): void {
  program
    .command("promote")
    .description("Convert ephemeral sandbox to permanent repository")
    .action(async () => {
      const creds = getCredentials()
      if (!creds) {
        console.error("Not authenticated. Run `kap10 auth login` first.")
        process.exit(1)
      }

      const config = loadConfig()
      if (!config?.repoId) {
        console.error(
          "No repo configured. Run `kap10 init` or `kap10 connect` first."
        )
        process.exit(1)
      }

      try {
        const serverUrl = config.serverUrl || creds.serverUrl
        const res = await fetch(
          `${serverUrl}/api/repos/${config.repoId}/promote`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${creds.apiKey}`,
              "Content-Type": "application/json",
            },
          }
        )

        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          console.error(
            `Failed to promote: ${body.error ?? res.statusText}`
          )
          process.exit(1)
        }

        console.log(
          "Repository promoted to permanent. Ephemeral expiry removed."
        )
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
