// src/commands/auth.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CONFIG_DIR = join(homedir(), ".kap10");
var CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
function getCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const content = readFileSync(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function saveCredentials(creds) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 384 });
}
async function deviceAuthFlow(serverUrl) {
  const res = await fetch(`${serverUrl}/api/cli/device-code`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to start auth flow: ${res.status} ${res.statusText}`);
  }
  const deviceAuth = await res.json();
  const authUrl = `${deviceAuth.verification_uri}?code=${deviceAuth.user_code}`;
  console.log("");
  console.log("  Open this URL in your browser:");
  console.log(`  ${authUrl}`);
  console.log("");
  console.log(`  Your code: ${deviceAuth.user_code}`);
  console.log("");
  try {
    const { execSync } = await import("child_process");
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${authUrl}"`, { stdio: "ignore" });
    } else if (platform === "linux") {
      execSync(`xdg-open "${authUrl}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${authUrl}"`, { stdio: "ignore" });
    }
    console.log("  Browser opened. Waiting for authorization...");
  } catch {
    console.log("  Could not open browser. Please open the URL manually.");
  }
  console.log("");
  const pollInterval = (deviceAuth.interval ?? 5) * 1e3;
  const deadline = Date.now() + deviceAuth.expires_in * 1e3;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const tokenRes = await fetch(`${serverUrl}/api/cli/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_code: deviceAuth.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    const tokenBody = await tokenRes.json();
    if (tokenBody.error === "authorization_pending") {
      continue;
    }
    if (tokenBody.error === "expired_token") {
      throw new Error("Authorization expired. Please run the command again.");
    }
    if (tokenBody.error) {
      throw new Error(`Authorization failed: ${tokenBody.error}`);
    }
    if (tokenBody.access_token) {
      if (tokenBody.key_already_existed) {
        const existing = getCredentials();
        if (existing?.apiKey?.startsWith("kap10_sk_")) {
          return {
            serverUrl,
            apiKey: existing.apiKey,
            orgId: tokenBody.org_id,
            orgName: tokenBody.org_name
          };
        }
        console.log("  A default API key already exists for this org.");
        console.log("  If you don't have it, create a new one in the dashboard.");
        throw new Error("Default key already exists. Use --key to provide it manually.");
      }
      return {
        serverUrl,
        apiKey: tokenBody.access_token,
        orgId: tokenBody.org_id,
        orgName: tokenBody.org_name
      };
    }
  }
  throw new Error("Authorization timed out. Please try again.");
}
function registerAuthCommand(program) {
  const auth = program.command("auth").description("Manage authentication");
  auth.command("login").description("Authenticate with kap10 server").option("--server <url>", "Server URL", "https://app.kap10.dev").option("--key <apiKey>", "API key (skip browser login)").action(async (opts) => {
    if (opts.key) {
      saveCredentials({ serverUrl: opts.server, apiKey: opts.key });
      console.log("Credentials saved.");
      return;
    }
    try {
      const creds = await deviceAuthFlow(opts.server);
      saveCredentials(creds);
      console.log(`Authenticated as ${creds.orgName ?? "your organization"}.`);
      console.log("Credentials saved to ~/.kap10/credentials.json");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
  auth.command("logout").description("Remove stored credentials").action(() => {
    if (existsSync(CREDENTIALS_PATH)) {
      unlinkSync(CREDENTIALS_PATH);
      console.log("Credentials removed.");
    } else {
      console.log("No credentials found.");
    }
  });
  auth.command("status").description("Check authentication status").action(() => {
    const creds = getCredentials();
    if (creds) {
      console.log(`Authenticated to: ${creds.serverUrl}`);
      console.log(`Organization: ${creds.orgName ?? "unknown"}`);
      console.log(`API Key: ${creds.apiKey.slice(0, 14)}****`);
    } else {
      console.log("Not authenticated. Run: kap10 auth login");
    }
  });
}

export {
  getCredentials,
  saveCredentials,
  deviceAuthFlow,
  registerAuthCommand
};
