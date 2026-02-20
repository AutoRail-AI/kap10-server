/**
 * kap10 auth — Authentication commands.
 *
 * kap10 auth login  — Open browser, poll for token, store credentials
 * kap10 auth logout — Delete stored credentials
 */

import { Command } from "commander"
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_DIR = join(homedir(), ".kap10")
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json")

export interface Credentials {
  serverUrl: string
  apiKey: string
  orgId?: string
}

export function getCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null
  try {
    const content = readFileSync(CREDENTIALS_PATH, "utf-8")
    return JSON.parse(content) as Credentials
  } catch {
    return null
  }
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authentication")

  auth
    .command("login")
    .description("Authenticate with kap10 server")
    .option("--server <url>", "Server URL", "https://app.kap10.dev")
    .option("--key <apiKey>", "API key (skip browser login)")
    .action(async (opts: { server: string; key?: string }) => {
      if (opts.key) {
        // Direct API key login
        saveCredentials({ serverUrl: opts.server, apiKey: opts.key })
        console.log("Credentials saved.")
        return
      }

      // Browser-based login
      console.log(`Opening browser for authentication at ${opts.server}...`)
      console.log("Paste your API key below after creating one in the dashboard:")
      console.log(`  ${opts.server}/repos → select repo → Connect to IDE → API Keys`)
      console.log("")

      // Read from stdin
      const readline = await import("node:readline")
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const apiKey = await new Promise<string>((resolve) => {
        rl.question("API Key: ", (answer) => {
          rl.close()
          resolve(answer.trim())
        })
      })

      if (!apiKey.startsWith("kap10_sk_")) {
        console.error("Invalid API key format. Expected kap10_sk_...")
        process.exit(1)
      }

      saveCredentials({ serverUrl: opts.server, apiKey })
      console.log("Credentials saved to ~/.kap10/credentials.json")
    })

  auth
    .command("logout")
    .description("Remove stored credentials")
    .action(() => {
      if (existsSync(CREDENTIALS_PATH)) {
        unlinkSync(CREDENTIALS_PATH)
        console.log("Credentials removed.")
      } else {
        console.log("No credentials found.")
      }
    })

  auth
    .command("status")
    .description("Check authentication status")
    .action(() => {
      const creds = getCredentials()
      if (creds) {
        console.log(`Authenticated to: ${creds.serverUrl}`)
        console.log(`API Key: ${creds.apiKey.slice(0, 14)}****`)
      } else {
        console.log("Not authenticated. Run: kap10 auth login")
      }
    })
}
