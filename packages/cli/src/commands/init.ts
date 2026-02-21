/**
 * kap10 init — Register a local repo with the kap10 server.
 * Creates .kap10/config.json and adds .kap10 to .gitignore.
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

interface KAP10Config {
  repoId: string
  serverUrl: string
  orgId: string
  branch: string
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Register this local repository with kap10 server")
    .option("--server <url>", "Server URL", process.env.KAP10_SERVER_URL ?? "http://localhost:3000")
    .option("--branch <branch>", "Default branch", "main")
    .option("--ephemeral", "Create an ephemeral sandbox (expires in 4 hours)")
    .action(async (opts: { server: string; branch: string; ephemeral?: boolean }) => {
      try {
        const creds = getCredentials()
        if (!creds?.apiKey) {
          console.error("Not authenticated. Run: kap10 auth login")
          process.exit(1)
        }

        // Detect repo name from git or directory
        const cwd = process.cwd()
        const repoName = path.basename(cwd)

        console.log(`Registering ${repoName} with kap10 server...`)

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

        // Create .kap10 directory and config
        const kap10Dir = path.join(cwd, ".kap10")
        if (!fs.existsSync(kap10Dir)) {
          fs.mkdirSync(kap10Dir, { recursive: true })
        }

        const config: KAP10Config = {
          repoId: result.repoId,
          serverUrl: opts.server,
          orgId: result.orgId,
          branch: opts.branch,
        }
        fs.writeFileSync(
          path.join(kap10Dir, "config.json"),
          JSON.stringify(config, null, 2) + "\n"
        )

        // Add .kap10 to .gitignore if not already there
        const gitignorePath = path.join(cwd, ".gitignore")
        if (fs.existsSync(gitignorePath)) {
          const content = fs.readFileSync(gitignorePath, "utf-8")
          if (!content.includes(".kap10")) {
            fs.appendFileSync(gitignorePath, "\n# kap10 local config\n.kap10/\n")
          }
        } else {
          fs.writeFileSync(gitignorePath, "# kap10 local config\n.kap10/\n")
        }

        console.log(`Registered repo: ${repoName} (${result.repoId})`)
        console.log(`  Config: .kap10/config.json`)
        if (opts.ephemeral) {
          console.log(`  Ephemeral sandbox created (expires in 4 hours). Use \`kap10 promote\` to make permanent.`)
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
