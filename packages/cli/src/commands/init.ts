/**
 * unerr init — Register a local repo with the unerr server.
 * Creates .unerr/config.json and adds .unerr to .gitignore.
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

interface UNERRConfig {
  repoId: string
  serverUrl: string
  orgId: string
  branch: string
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Register this local repository with unerr server")
    .option("--server <url>", "Server URL", process.env.UNERR_SERVER_URL ?? "http://localhost:3000")
    .option("--branch <branch>", "Default branch", "main")
    .option("--ephemeral", "Create an ephemeral sandbox (expires in 4 hours)")
    .action(async (opts: { server: string; branch: string; ephemeral?: boolean }) => {
      try {
        const creds = getCredentials()
        if (!creds?.apiKey) {
          console.error("Not authenticated. Run: unerr auth login")
          process.exit(1)
        }

        // Detect repo name from git or directory
        const cwd = process.cwd()
        const repoName = path.basename(cwd)

        console.log(`Registering ${repoName} with unerr server...`)

        const res = await fetch(`${opts.server}/api/cli/init`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`,
          },
          body: JSON.stringify({
            name: repoName,
            fullName: repoName,
            branch: opts.branch,
            ...(opts.ephemeral && { ephemeral: true }),
          }),
        })

        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          console.error(`Failed: ${body.error ?? res.statusText}`)
          process.exit(1)
        }

        const result = (await res.json()) as { repoId: string; orgId: string }

        // Create .unerr directory and config
        const unerrDir = path.join(cwd, ".unerr")
        if (!fs.existsSync(unerrDir)) {
          fs.mkdirSync(unerrDir, { recursive: true })
        }

        const config: UNERRConfig = {
          repoId: result.repoId,
          serverUrl: opts.server,
          orgId: result.orgId,
          branch: opts.branch,
        }
        fs.writeFileSync(
          path.join(unerrDir, "config.json"),
          JSON.stringify(config, null, 2) + "\n"
        )

        // Add .unerr to .gitignore if not already there
        const gitignorePath = path.join(cwd, ".gitignore")
        if (fs.existsSync(gitignorePath)) {
          const content = fs.readFileSync(gitignorePath, "utf-8")
          if (!content.includes(".unerr")) {
            fs.appendFileSync(gitignorePath, "\n# unerr local config\n.unerr/\n")
          }
        } else {
          fs.writeFileSync(gitignorePath, "# unerr local config\n.unerr/\n")
        }

        console.log(`Registered repo: ${repoName} (${result.repoId})`)
        console.log(`  Config: .unerr/config.json`)
        if (opts.ephemeral) {
          console.log(`  Ephemeral sandbox created (expires in 4 hours). Use \`unerr promote\` to make permanent.`)
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
