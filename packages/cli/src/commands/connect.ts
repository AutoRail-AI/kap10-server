/**
 * kap10 connect — Golden path CLI command.
 *
 * Handles: auth → git context detection → repo check → IDE config → done.
 * One command to go from zero to MCP-connected.
 */

import { Command } from "commander"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { getCredentials, saveCredentials, deviceAuthFlow } from "./auth.js"

interface GitContext {
  remote: string
  branch: string
  owner: string
  repo: string
  fullName: string
}

function detectGitContext(): GitContext | null {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process")

    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const branch = execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    // Parse remote to extract owner/repo
    const fullName = parseRemote(remote)
    if (!fullName) return null

    const parts = fullName.split("/")
    if (parts.length < 2) return null

    return {
      remote,
      branch: branch || "main",
      owner: parts[0]!,
      repo: parts[1]!,
      fullName,
    }
  } catch {
    return null
  }
}

function parseRemote(remote: string): string | null {
  // git@github.com:owner/repo.git
  const sshMatch = remote.match(/git@[^:]+:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1] ?? null

  // https://github.com/owner/repo.git
  const httpMatch = remote.match(/(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+?)(?:\.git)?$/)
  if (httpMatch) return httpMatch[1] ?? null

  return null
}

type IdeType = "cursor" | "claude-code" | "vscode" | "unknown"

function detectIde(): IdeType {
  const cwd = process.cwd()
  if (existsSync(join(cwd, ".cursor"))) return "cursor"
  if (existsSync(join(cwd, ".vscode"))) return "vscode"
  return "unknown"
}

function writeMcpConfig(
  ide: IdeType,
  serverUrl: string,
  apiKey: string,
  repoName: string
): void {
  const cwd = process.cwd()

  if (ide === "cursor") {
    const configDir = join(cwd, ".cursor")
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "mcp.json")

    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
      } catch {
        // Start fresh
      }
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
    mcpServers["kap10"] = {
      url: `${serverUrl}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
    config.mcpServers = mcpServers

    writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log(`  Written: .cursor/mcp.json`)
  } else if (ide === "vscode") {
    const configDir = join(cwd, ".vscode")
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "settings.json")

    let settings: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        settings = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
      } catch {
        // Start fresh
      }
    }

    const mcpServers = (settings["mcp.servers"] ?? {}) as Record<string, unknown>
    mcpServers["kap10"] = {
      url: `${serverUrl}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
    settings["mcp.servers"] = mcpServers

    writeFileSync(configPath, JSON.stringify(settings, null, 2))
    console.log(`  Written: .vscode/settings.json`)
  }

  // Always print Claude Code command
  console.log("")
  console.log("  For Claude Code, run:")
  console.log(`  claude mcp add kap10 --transport http "${serverUrl}/mcp" \\`)
  console.log(`    --header "Authorization: Bearer ${apiKey}"`)
  console.log("")
  console.log(`  MCP configured for ${repoName}.`)
}

export function registerConnectCommand(program: Command): void {
  program
    .command("connect")
    .description("Connect current repo to kap10 MCP (auth + detect + configure)")
    .option("--server <url>", "Server URL", "https://app.kap10.dev")
    .option("--key <apiKey>", "API key (skip browser login)")
    .option("--ide <type>", "IDE type: cursor, vscode, claude-code")
    .action(
      async (opts: { server: string; key?: string; ide?: string }) => {
        // Step 1: Ensure authenticated
        let creds = getCredentials()
        if (!creds || opts.key) {
          if (opts.key) {
            creds = { serverUrl: opts.server, apiKey: opts.key }
            saveCredentials(creds)
            console.log("API key saved.")
          } else {
            console.log("Not authenticated. Starting login flow...")
            console.log("")
            try {
              creds = await deviceAuthFlow(opts.server)
              saveCredentials(creds)
              console.log(
                `Authenticated as ${creds.orgName ?? "your organization"}.`
              )
              console.log("")
            } catch (error: unknown) {
              console.error(
                error instanceof Error ? error.message : String(error)
              )
              process.exit(1)
            }
          }
        } else {
          console.log(
            `Authenticated as ${creds.orgName ?? creds.serverUrl}.`
          )
        }

        const serverUrl = creds.serverUrl

        // Step 2: Detect git context
        console.log("Detecting git context...")
        const git = detectGitContext()
        if (!git) {
          console.log("")
          console.log(
            "No git repository detected. Run this command from inside a git repo."
          )
          process.exit(1)
        }
        console.log(`  Repository: ${git.fullName}`)
        console.log(`  Branch: ${git.branch}`)
        console.log("")

        // Step 3: Check if repo exists on kap10
        console.log("Checking kap10...")
        try {
          const contextRes = await fetch(
            `${serverUrl}/api/cli/context?remote=${encodeURIComponent(git.remote)}`,
            {
              headers: {
                Authorization: `Bearer ${creds.apiKey}`,
              },
            }
          )

          if (contextRes.ok) {
            const ctx = (await contextRes.json()) as {
              repoId: string
              repoName: string
              status: string
              indexed: boolean
            }
            console.log(`  Found: ${ctx.repoName} (${ctx.status})`)

            if (!ctx.indexed) {
              console.log(
                "  Repo is still indexing. MCP will work once indexing completes."
              )
            }
          } else if (contextRes.status === 404) {
            console.log(
              "  This repo isn't on kap10 yet."
            )
            console.log(
              "  Add it via the dashboard or connect GitHub at:"
            )
            console.log(`  ${serverUrl}/settings/connections`)
            console.log("")
          } else {
            console.log(
              `  Warning: could not check repo status (${contextRes.status})`
            )
          }
        } catch {
          console.log(
            "  Warning: could not reach server to check repo status."
          )
        }

        // Step 4: Configure IDE
        const ide = (opts.ide as IdeType) ?? detectIde()
        console.log("")
        console.log(
          `Configuring MCP${ide !== "unknown" ? ` for ${ide}` : ""}...`
        )
        writeMcpConfig(ide, serverUrl, creds.apiKey, git.fullName)
      }
    )
}
