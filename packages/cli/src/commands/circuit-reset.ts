/**
 * kap10 circuit-reset — Reset a tripped circuit breaker for an entity.
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

export function registerCircuitResetCommand(program: Command): void {
  program
    .command("circuit-reset <entity-key>")
    .description("Reset a tripped circuit breaker for an entity")
    .action(async (entityKey: string) => {
      try {
        const config = loadConfig()
        if (!config) { console.error("Not initialized. Run: kap10 init"); process.exit(1) }
        const creds = getCredentials()
        if (!creds?.apiKey) { console.error("Not authenticated. Run: kap10 auth login"); process.exit(1) }

        const res = await fetch(
          `${config.serverUrl}/api/repos/${config.repoId}/circuit-breaker/reset`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${creds.apiKey}`,
            },
            body: JSON.stringify({ entityKey }),
          }
        )

        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          console.error(`Failed: ${body.error ?? res.statusText}`)
          process.exit(1)
        }

        console.log(`Circuit breaker reset for entity: ${entityKey}`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
