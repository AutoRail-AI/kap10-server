#!/usr/bin/env node
import {
  __require
} from "./chunk-3RG5ZIWI.js";

// src/index.ts
import { Command } from "commander";

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
function registerAuthCommand(program2) {
  const auth = program2.command("auth").description("Manage authentication");
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

// src/commands/connect.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { join as join2 } from "path";
function detectGitContext() {
  try {
    const { execSync } = __require("child_process");
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const branch = execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const fullName = parseRemote(remote);
    if (!fullName) return null;
    const parts = fullName.split("/");
    if (parts.length < 2) return null;
    return {
      remote,
      branch: branch || "main",
      owner: parts[0],
      repo: parts[1],
      fullName
    };
  } catch {
    return null;
  }
}
function parseRemote(remote) {
  const sshMatch = remote.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1] ?? null;
  const httpMatch = remote.match(/(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+?)(?:\.git)?$/);
  if (httpMatch) return httpMatch[1] ?? null;
  return null;
}
function detectIde() {
  const cwd = process.cwd();
  if (existsSync2(join2(cwd, ".cursor"))) return "cursor";
  if (existsSync2(join2(cwd, ".vscode"))) return "vscode";
  return "unknown";
}
function writeMcpConfig(ide, serverUrl, apiKey, repoName) {
  const cwd = process.cwd();
  if (ide === "cursor") {
    const configDir = join2(cwd, ".cursor");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join2(configDir, "mcp.json");
    let config = {};
    if (existsSync2(configPath)) {
      try {
        config = JSON.parse(readFileSync2(configPath, "utf-8"));
      } catch {
      }
    }
    const mcpServers = config.mcpServers ?? {};
    mcpServers["kap10"] = {
      url: `${serverUrl}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    };
    config.mcpServers = mcpServers;
    writeFileSync2(configPath, JSON.stringify(config, null, 2));
    console.log(`  Written: .cursor/mcp.json`);
  } else if (ide === "vscode") {
    const configDir = join2(cwd, ".vscode");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join2(configDir, "settings.json");
    let settings = {};
    if (existsSync2(configPath)) {
      try {
        settings = JSON.parse(readFileSync2(configPath, "utf-8"));
      } catch {
      }
    }
    const mcpServers = settings["mcp.servers"] ?? {};
    mcpServers["kap10"] = {
      url: `${serverUrl}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    };
    settings["mcp.servers"] = mcpServers;
    writeFileSync2(configPath, JSON.stringify(settings, null, 2));
    console.log(`  Written: .vscode/settings.json`);
  }
  console.log("");
  console.log("  For Claude Code, run:");
  console.log(`  claude mcp add kap10 --transport http "${serverUrl}/mcp" \\`);
  console.log(`    --header "Authorization: Bearer ${apiKey}"`);
  console.log("");
  console.log(`  MCP configured for ${repoName}.`);
}
function registerConnectCommand(program2) {
  program2.command("connect").description("Connect current repo to kap10 MCP (auth + detect + configure)").option("--server <url>", "Server URL", "https://app.kap10.dev").option("--key <apiKey>", "API key (skip browser login)").option("--ide <type>", "IDE type: cursor, vscode, claude-code").action(
    async (opts) => {
      let creds = getCredentials();
      if (!creds || opts.key) {
        if (opts.key) {
          creds = { serverUrl: opts.server, apiKey: opts.key };
          saveCredentials(creds);
          console.log("API key saved.");
        } else {
          console.log("Not authenticated. Starting login flow...");
          console.log("");
          try {
            creds = await deviceAuthFlow(opts.server);
            saveCredentials(creds);
            console.log(
              `Authenticated as ${creds.orgName ?? "your organization"}.`
            );
            console.log("");
          } catch (error) {
            console.error(
              error instanceof Error ? error.message : String(error)
            );
            process.exit(1);
          }
        }
      } else {
        console.log(
          `Authenticated as ${creds.orgName ?? creds.serverUrl}.`
        );
      }
      const serverUrl = creds.serverUrl;
      console.log("Detecting git context...");
      const git = detectGitContext();
      if (!git) {
        console.log("");
        console.log(
          "No git repository detected. Run this command from inside a git repo."
        );
        process.exit(1);
      }
      console.log(`  Repository: ${git.fullName}`);
      console.log(`  Branch: ${git.branch}`);
      console.log("");
      console.log("Checking kap10...");
      try {
        const contextRes = await fetch(
          `${serverUrl}/api/cli/context?remote=${encodeURIComponent(git.remote)}`,
          {
            headers: {
              Authorization: `Bearer ${creds.apiKey}`
            }
          }
        );
        if (contextRes.ok) {
          const ctx = await contextRes.json();
          console.log(`  Found: ${ctx.repoName} (${ctx.status})`);
          if (!ctx.indexed) {
            console.log(
              "  Repo is still indexing. MCP will work once indexing completes."
            );
          }
        } else if (contextRes.status === 404) {
          console.log(
            "  This repo isn't on kap10 yet."
          );
          console.log(
            "  Add it via the dashboard or connect GitHub at:"
          );
          console.log(`  ${serverUrl}/settings/connections`);
          console.log("");
        } else {
          console.log(
            `  Warning: could not check repo status (${contextRes.status})`
          );
        }
      } catch {
        console.log(
          "  Warning: could not reach server to check repo status."
        );
      }
      const ide = opts.ide ?? detectIde();
      console.log("");
      console.log(
        `Configuring MCP${ide !== "unknown" ? ` for ${ide}` : ""}...`
      );
      writeMcpConfig(ide, serverUrl, creds.apiKey, git.fullName);
    }
  );
}

// src/commands/pull.ts
import { createHash } from "crypto";
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, existsSync as existsSync3 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
var KAP10_DIR = join3(homedir2(), ".kap10");
var SNAPSHOTS_DIR = join3(KAP10_DIR, "snapshots");
var MANIFESTS_DIR = join3(KAP10_DIR, "manifests");
function getManifest(repoId) {
  const path = join3(MANIFESTS_DIR, `${repoId}.json`);
  if (!existsSync3(path)) return null;
  try {
    return JSON.parse(readFileSync3(path, "utf-8"));
  } catch {
    return null;
  }
}
function registerPullCommand(program2) {
  program2.command("pull").description("Download graph snapshot for a repo").requiredOption("--repo <repoId>", "Repository ID").option("--force", "Force re-download even if up to date").action(async (opts) => {
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run: kap10 auth login");
      process.exit(1);
    }
    const { repo: repoId, force } = opts;
    if (!force) {
      const existing = getManifest(repoId);
      if (existing) {
        console.log(`Existing snapshot found (${existing.checksum.slice(0, 8)}...)`);
      }
    }
    console.log("Fetching download URL...");
    const metaRes = await fetch(`${creds.serverUrl}/api/graph-snapshots/${repoId}/download`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` }
    });
    if (!metaRes.ok) {
      const body = await metaRes.json().catch(() => ({}));
      console.error(`Failed to get download URL: ${body.error ?? metaRes.statusText}`);
      process.exit(1);
    }
    const meta = await metaRes.json();
    const { url, checksum, entityCount, edgeCount, sizeBytes, generatedAt } = meta.data;
    if (!force) {
      const existing = getManifest(repoId);
      if (existing && existing.checksum === checksum) {
        console.log("Snapshot is already up to date.");
        return;
      }
    }
    console.log(`Downloading snapshot (${(sizeBytes / 1024).toFixed(1)} KB)...`);
    const downloadRes = await fetch(url);
    if (!downloadRes.ok) {
      console.error("Download failed");
      process.exit(1);
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log("Verifying checksum...");
    const computedChecksum = createHash("sha256").update(buffer).digest("hex");
    if (computedChecksum !== checksum) {
      console.error(`Checksum mismatch! Expected ${checksum.slice(0, 8)}..., got ${computedChecksum.slice(0, 8)}...`);
      process.exit(1);
    }
    mkdirSync3(SNAPSHOTS_DIR, { recursive: true });
    mkdirSync3(MANIFESTS_DIR, { recursive: true });
    const snapshotPath = join3(SNAPSHOTS_DIR, `${repoId}.msgpack`);
    writeFileSync3(snapshotPath, buffer);
    const manifest = {
      repoId,
      checksum,
      sizeBytes: buffer.length,
      entityCount,
      edgeCount,
      generatedAt,
      pulledAt: (/* @__PURE__ */ new Date()).toISOString(),
      snapshotPath
    };
    writeFileSync3(join3(MANIFESTS_DIR, `${repoId}.json`), JSON.stringify(manifest, null, 2));
    console.log(`Done! ${entityCount} entities, ${edgeCount} edges`);
    console.log(`Saved to ${snapshotPath}`);
  });
}

// src/commands/serve.ts
import { readFileSync as readFileSync4, existsSync as existsSync4, readdirSync } from "fs";
import { homedir as homedir3 } from "os";
import { join as join4 } from "path";

// src/auto-sync.ts
var DEFAULT_TTL_HOURS = 24;
function getStalenessInfo(repoId) {
  const manifest = getManifest(repoId);
  if (!manifest) return { isStale: true, ageHours: Infinity, pulledAt: null };
  const pulledAt = new Date(manifest.pulledAt).getTime();
  const ageHours = (Date.now() - pulledAt) / (1e3 * 60 * 60);
  return {
    isStale: ageHours > DEFAULT_TTL_HOURS,
    ageHours: Math.round(ageHours * 10) / 10,
    pulledAt: manifest.pulledAt
  };
}

// src/commands/serve.ts
var KAP10_DIR2 = join4(homedir3(), ".kap10");
var SNAPSHOTS_DIR2 = join4(KAP10_DIR2, "snapshots");
var MANIFESTS_DIR2 = join4(KAP10_DIR2, "manifests");
function registerServeCommand(program2) {
  program2.command("serve").description("Start local MCP server").option("--repo <repoId>", "Specific repo to serve (default: all pulled repos)").action(async (opts) => {
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run: kap10 auth login");
      process.exit(1);
    }
    let repoIds = [];
    if (opts.repo) {
      repoIds = [opts.repo];
    } else {
      if (existsSync4(MANIFESTS_DIR2)) {
        repoIds = readdirSync(MANIFESTS_DIR2).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
      }
    }
    if (repoIds.length === 0) {
      console.error("No snapshots found. Run: kap10 pull --repo <repoId>");
      process.exit(1);
    }
    for (const repoId of repoIds) {
      const info = getStalenessInfo(repoId);
      if (info.isStale) {
        console.warn(`Warning: Snapshot for ${repoId} is ${info.ageHours}h old (stale). Run: kap10 pull --repo ${repoId}`);
      }
    }
    console.log("Initializing CozoDB...");
    let CozoDb;
    try {
      const cozoModule = await import("cozo-node");
      CozoDb = cozoModule.default ? cozoModule.default.CozoDb : cozoModule.CozoDb;
    } catch (err) {
      console.error("Failed to load cozo-node. Install it: npm install cozo-node");
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const db = new CozoDb();
    const { CozoGraphStore } = await import("./local-graph-AJM6PEGS.js");
    const localGraph = new CozoGraphStore(db);
    for (const repoId of repoIds) {
      const manifest = getManifest(repoId);
      if (!manifest) {
        console.warn(`No manifest for ${repoId}, skipping`);
        continue;
      }
      const snapshotPath = join4(SNAPSHOTS_DIR2, `${repoId}.msgpack`);
      if (!existsSync4(snapshotPath)) {
        console.warn(`Snapshot file not found for ${repoId}, skipping`);
        continue;
      }
      console.log(`Loading snapshot for ${repoId}...`);
      const { unpack } = await import("msgpackr");
      const buffer = readFileSync4(snapshotPath);
      const envelope = unpack(buffer);
      localGraph.loadSnapshot(envelope);
      console.log(`Loaded ${manifest.entityCount} entities, ${manifest.edgeCount} edges`);
    }
    const { CloudProxy } = await import("./cloud-proxy-OYOBTZTT.js");
    const cloudProxy = new CloudProxy({
      serverUrl: creds.serverUrl,
      apiKey: creds.apiKey
    });
    const { QueryRouter } = await import("./query-router-KJCUB7F2.js");
    const router = new QueryRouter(localGraph, cloudProxy);
    console.log("Starting MCP server on stdio...");
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = new Server(
      { name: "kap10-local", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );
    const toolDefinitions = [
      { name: "get_function", description: "Get function details by key", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
      { name: "get_class", description: "Get class details by key", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
      { name: "get_file", description: "Get file entities by key", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
      { name: "get_callers", description: "Get callers of an entity", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
      { name: "get_callees", description: "Get callees of an entity", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
      { name: "get_imports", description: "Get imports for a file", inputSchema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
      { name: "search_code", description: "Search code entities by name", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
      { name: "semantic_search", description: "Semantic search (cloud)", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
      { name: "find_similar", description: "Find similar entities (cloud)", inputSchema: { type: "object", properties: { key: { type: "string" }, limit: { type: "number" } }, required: ["key"] } },
      { name: "get_project_stats", description: "Get project stats (cloud)", inputSchema: { type: "object", properties: {} } },
      { name: "sync_local_diff", description: "Sync local changes (cloud)", inputSchema: { type: "object", properties: { diff: { type: "string" } }, required: ["diff"] } }
    ];
    server.setRequestHandler(
      { method: "tools/list" },
      async () => ({ tools: toolDefinitions })
    );
    server.setRequestHandler(
      { method: "tools/call" },
      async (request) => {
        const { name, arguments: args = {} } = request.params;
        const result = await router.execute(name, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result.content, null, 2) }],
          _meta: result._meta
        };
      }
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("kap10 MCP server running on stdio");
  });
}

// src/index.ts
var program = new Command();
program.name("kap10").description("Local-first code intelligence CLI").version("0.1.0");
registerAuthCommand(program);
registerConnectCommand(program);
registerPullCommand(program);
registerServeCommand(program);
program.parse();
