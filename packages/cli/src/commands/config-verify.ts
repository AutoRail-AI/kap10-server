/**
 * unerr config verify — P5.6-ADV-04: Self-healing MCP configuration.
 * Checks and repairs MCP config for supported IDEs (VS Code, Cursor, etc.)
 */

import { Command } from "commander"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

interface MCPConfig {
  mcpServers?: Record<string, {
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
  }>
}

const IDE_CONFIG_PATHS: Record<string, string> = {
  "vscode": path.join(os.homedir(), ".vscode", "settings.json"),
  "cursor": path.join(os.homedir(), ".cursor", "mcp.json"),
  "windsurf": path.join(os.homedir(), ".windsurf", "mcp.json"),
}

function loadConfig(): { repoId: string; serverUrl: string; orgId: string } | null {
  const configPath = path.join(process.cwd(), ".unerr", "config.json")
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as { repoId: string; serverUrl: string; orgId: string }
}

function checkIdeConfig(ideName: string, configPath: string, serverUrl: string): {
  found: boolean
  configured: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (!fs.existsSync(configPath)) {
    return { found: false, configured: false, issues: [`${ideName} config not found at ${configPath}`] }
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as MCPConfig

    if (!config.mcpServers) {
      issues.push(`${ideName}: No mcpServers section found`)
      return { found: true, configured: false, issues }
    }

    const unerrServer = config.mcpServers["unerr"]
    if (!unerrServer) {
      issues.push(`${ideName}: No unerr MCP server configured`)
      return { found: true, configured: false, issues }
    }

    // Check URL
    if (unerrServer.url && !unerrServer.url.includes(serverUrl.replace(/^https?:\/\//, ""))) {
      issues.push(`${ideName}: unerr server URL mismatch (expected: ${serverUrl})`)
    }

    return { found: true, configured: true, issues }
  } catch {
    issues.push(`${ideName}: Failed to parse config at ${configPath}`)
    return { found: true, configured: false, issues }
  }
}

function repairIdeConfig(ideName: string, configPath: string, serverUrl: string, apiKey?: string): boolean {
  try {
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let config: MCPConfig = {}
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8")
      config = JSON.parse(raw) as MCPConfig
    }

    if (!config.mcpServers) config.mcpServers = {}

    config.mcpServers["unerr"] = {
      url: `${serverUrl}/api/mcp/sse`,
      env: apiKey ? { UNERR_API_KEY: apiKey } : {},
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}

export function registerConfigVerifyCommand(program: Command) {
  const configCmd = program
    .command("config")
    .description("Manage unerr configuration")

  configCmd
    .command("verify")
    .description("Check and optionally repair MCP configuration for IDEs")
    .option("--silent", "Only output errors")
    .option("--repair", "Automatically repair misconfigured IDEs")
    .option("--ide <ide>", "Check specific IDE (vscode, cursor, windsurf)")
    .action(async (opts: { silent?: boolean; repair?: boolean; ide?: string }) => {
      const unerrConfig = loadConfig()
      const serverUrl = unerrConfig?.serverUrl ?? process.env.UNERR_SERVER_URL ?? "http://localhost:3000"

      const idesToCheck = opts.ide
        ? { [opts.ide]: IDE_CONFIG_PATHS[opts.ide] ?? "" }
        : IDE_CONFIG_PATHS

      let allGood = true

      for (const [ideName, configPath] of Object.entries(idesToCheck)) {
        if (!configPath) {
          if (!opts.silent) console.log(`  Unknown IDE: ${ideName}`)
          continue
        }

        const result = checkIdeConfig(ideName, configPath, serverUrl)

        if (result.configured && result.issues.length === 0) {
          if (!opts.silent) console.log(`  ✓ ${ideName}: configured correctly`)
        } else {
          allGood = false
          for (const issue of result.issues) {
            console.log(`  ✗ ${issue}`)
          }

          if (opts.repair) {
            const repaired = repairIdeConfig(ideName, configPath, serverUrl)
            if (repaired) {
              console.log(`  ✓ ${ideName}: repaired`)
            } else {
              console.log(`  ✗ ${ideName}: repair failed`)
            }
          }
        }
      }

      if (!allGood && !opts.repair) {
        console.log("\n  Run with --repair to fix issues automatically.")
      }

      if (allGood && !opts.silent) {
        console.log("\n  All IDE configurations look good!")
      }
    })

  // Git hooks sub-command
  configCmd
    .command("install-hooks")
    .description("Install git hooks for automatic MCP config verification")
    .action(async () => {
      const gitDir = path.join(process.cwd(), ".git")
      if (!fs.existsSync(gitDir)) {
        console.error("Not a git repository")
        process.exit(1)
      }

      const hooksDir = path.join(gitDir, "hooks")
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true })
      }

      const hookScript = `#!/bin/sh
# unerr auto-verify MCP config
if command -v unerr &> /dev/null; then
  unerr config verify --silent 2>/dev/null || true
fi
`

      for (const hookName of ["post-checkout", "post-merge"]) {
        const hookPath = path.join(hooksDir, hookName)
        if (fs.existsSync(hookPath)) {
          const existing = fs.readFileSync(hookPath, "utf-8")
          if (existing.includes("unerr config verify")) {
            console.log(`  ✓ ${hookName}: already installed`)
            continue
          }
          fs.appendFileSync(hookPath, "\n" + hookScript)
        } else {
          fs.writeFileSync(hookPath, hookScript)
          fs.chmodSync(hookPath, "755")
        }
        console.log(`  ✓ ${hookName}: installed`)
      }
    })
}
