/**
 * unerr auth — Authentication commands.
 *
 * unerr auth login  — Device OAuth flow (browser) or direct API key
 * unerr auth logout — Delete stored credentials
 * unerr auth status — Show current auth state
 */

import { Command } from "commander"
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_DIR = join(homedir(), ".unerr")
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json")

export interface Credentials {
  serverUrl: string
  apiKey: string
  orgId?: string
  orgName?: string
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

/**
 * Run the device authorization flow:
 * 1. Request device code from server
 * 2. Open browser for user to authorize
 * 3. Poll for token until approved
 */
export async function deviceAuthFlow(serverUrl: string): Promise<Credentials> {
  // Step 1: Request device code
  const res = await fetch(`${serverUrl}/api/cli/device-code`, { method: "POST" })
  if (!res.ok) {
    throw new Error(`Failed to start auth flow: ${res.status} ${res.statusText}`)
  }

  const deviceAuth = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  // Step 2: Show code and try to open browser
  const authUrl = `${deviceAuth.verification_uri}?code=${deviceAuth.user_code}`
  console.log("")
  console.log("  Open this URL in your browser:")
  console.log(`  ${authUrl}`)
  console.log("")
  console.log(`  Your code: ${deviceAuth.user_code}`)
  console.log("")

  // Try to open browser
  try {
    const { execSync } = await import("node:child_process")
    const platform = process.platform
    if (platform === "darwin") {
      execSync(`open "${authUrl}"`, { stdio: "ignore" })
    } else if (platform === "linux") {
      execSync(`xdg-open "${authUrl}"`, { stdio: "ignore" })
    } else if (platform === "win32") {
      execSync(`start "" "${authUrl}"`, { stdio: "ignore" })
    }
    console.log("  Browser opened. Waiting for authorization...")
  } catch {
    console.log("  Could not open browser. Please open the URL manually.")
  }
  console.log("")

  // Step 3: Poll for token
  const pollInterval = (deviceAuth.interval ?? 5) * 1000
  const deadline = Date.now() + deviceAuth.expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval))

    const tokenRes = await fetch(`${serverUrl}/api/cli/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_code: deviceAuth.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    const tokenBody = (await tokenRes.json()) as {
      error?: string
      access_token?: string
      org_id?: string
      org_name?: string
      server_url?: string
      key_already_existed?: boolean
    }

    if (tokenBody.error === "authorization_pending") {
      continue
    }

    if (tokenBody.error === "expired_token") {
      throw new Error("Authorization expired. Please run the command again.")
    }

    if (tokenBody.error) {
      throw new Error(`Authorization failed: ${tokenBody.error}`)
    }

    if (tokenBody.access_token) {
      if (tokenBody.key_already_existed) {
        // Key already existed — user must provide it or we use the one on disk
        const existing = getCredentials()
        if (existing?.apiKey?.startsWith("unerr_sk_")) {
          return {
            serverUrl,
            apiKey: existing.apiKey,
            orgId: tokenBody.org_id,
            orgName: tokenBody.org_name,
          }
        }
        // Can't retrieve existing key — need manual entry
        console.log("  A default API key already exists for this org.")
        console.log("  If you don't have it, create a new one in the dashboard.")
        throw new Error("Default key already exists. Use --key to provide it manually.")
      }

      return {
        serverUrl,
        apiKey: tokenBody.access_token,
        orgId: tokenBody.org_id,
        orgName: tokenBody.org_name,
      }
    }
  }

  throw new Error("Authorization timed out. Please try again.")
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authentication")

  auth
    .command("login")
    .description("Authenticate with unerr server")
    .option("--server <url>", "Server URL", "https://app.unerr.dev")
    .option("--key <apiKey>", "API key (skip browser login)")
    .action(async (opts: { server: string; key?: string }) => {
      if (opts.key) {
        saveCredentials({ serverUrl: opts.server, apiKey: opts.key })
        console.log("Credentials saved.")
        return
      }

      try {
        const creds = await deviceAuthFlow(opts.server)
        saveCredentials(creds)
        console.log(`Authenticated as ${creds.orgName ?? "your organization"}.`)
        console.log("Credentials saved to ~/.unerr/credentials.json")
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
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
        console.log(`Organization: ${creds.orgName ?? "unknown"}`)
        console.log(`API Key: ${creds.apiKey.slice(0, 14)}****`)
      } else {
        console.log("Not authenticated. Run: unerr auth login")
      }
    })
}
