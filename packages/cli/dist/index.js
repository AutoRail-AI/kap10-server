#!/usr/bin/env node
import {
  createIgnoreFilter,
  deviceAuthFlow,
  getCredentials,
  registerAuthCommand,
  saveCredentials
} from "./chunk-SJO3YGSB.js";
import {
  __require
} from "./chunk-3RG5ZIWI.js";

// src/index.ts
import { Command } from "commander";

// src/commands/branches.ts
import * as fs from "fs";
import * as path from "path";
function loadConfig() {
  const configPath = path.join(process.cwd(), ".unerr", "config.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
function registerBranchesCommand(program2) {
  program2.command("branches").description("Show timeline branches for this repository").action(async () => {
    try {
      const config = loadConfig();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const res = await fetch(
        `${config.serverUrl}/api/repos/${config.repoId}/timeline?limit=200`,
        { headers: { Authorization: `Bearer ${creds.apiKey}` } }
      );
      if (!res.ok) {
        console.error(`Failed: ${res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      const branches = /* @__PURE__ */ new Map();
      for (const entry of data.items) {
        const key = `${entry.branch}#${entry.timeline_branch}`;
        const existing = branches.get(key) ?? { count: 0, latest: "", statuses: /* @__PURE__ */ new Set() };
        existing.count++;
        existing.statuses.add(entry.status);
        if (!existing.latest || entry.created_at > existing.latest) {
          existing.latest = entry.created_at;
        }
        branches.set(key, existing);
      }
      if (branches.size === 0) {
        console.log("No timeline branches found.");
        return;
      }
      console.log("\n  Branch              Entries  Statuses              Last Activity");
      console.log("  " + "\u2500".repeat(75));
      for (const [key, info] of Array.from(branches.entries())) {
        const statuses = Array.from(info.statuses).join(", ");
        console.log(
          `  ${key.padEnd(20)} ${String(info.count).padEnd(8)} ${statuses.padEnd(22)} ${new Date(info.latest).toLocaleString()}`
        );
      }
      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/circuit-reset.ts
import * as fs2 from "fs";
import * as path2 from "path";
function loadConfig2() {
  const configPath = path2.join(process.cwd(), ".unerr", "config.json");
  if (!fs2.existsSync(configPath)) return null;
  return JSON.parse(fs2.readFileSync(configPath, "utf-8"));
}
function registerCircuitResetCommand(program2) {
  program2.command("circuit-reset <entity-key>").description("Reset a tripped circuit breaker for an entity").action(async (entityKey) => {
    try {
      const config = loadConfig2();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const res = await fetch(
        `${config.serverUrl}/api/repos/${config.repoId}/circuit-breaker/reset`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`
          },
          body: JSON.stringify({ entityKey })
        }
      );
      if (!res.ok) {
        const body = await res.json();
        console.error(`Failed: ${body.error ?? res.statusText}`);
        process.exit(1);
      }
      console.log(`Circuit breaker reset for entity: ${entityKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/config-verify.ts
import * as fs3 from "fs";
import * as os from "os";
import * as path3 from "path";
var IDE_CONFIG_PATHS = {
  "vscode": path3.join(os.homedir(), ".vscode", "settings.json"),
  "cursor": path3.join(os.homedir(), ".cursor", "mcp.json"),
  "windsurf": path3.join(os.homedir(), ".windsurf", "mcp.json")
};
function loadConfig3() {
  const configPath = path3.join(process.cwd(), ".unerr", "config.json");
  if (!fs3.existsSync(configPath)) return null;
  return JSON.parse(fs3.readFileSync(configPath, "utf-8"));
}
function checkIdeConfig(ideName, configPath, serverUrl) {
  const issues = [];
  if (!fs3.existsSync(configPath)) {
    return { found: false, configured: false, issues: [`${ideName} config not found at ${configPath}`] };
  }
  try {
    const raw = fs3.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (!config.mcpServers) {
      issues.push(`${ideName}: No mcpServers section found`);
      return { found: true, configured: false, issues };
    }
    const unerrServer = config.mcpServers["unerr"];
    if (!unerrServer) {
      issues.push(`${ideName}: No unerr MCP server configured`);
      return { found: true, configured: false, issues };
    }
    if (unerrServer.url && !unerrServer.url.includes(serverUrl.replace(/^https?:\/\//, ""))) {
      issues.push(`${ideName}: unerr server URL mismatch (expected: ${serverUrl})`);
    }
    return { found: true, configured: true, issues };
  } catch {
    issues.push(`${ideName}: Failed to parse config at ${configPath}`);
    return { found: true, configured: false, issues };
  }
}
function repairIdeConfig(ideName, configPath, serverUrl, apiKey) {
  try {
    const dir = path3.dirname(configPath);
    if (!fs3.existsSync(dir)) {
      fs3.mkdirSync(dir, { recursive: true });
    }
    let config = {};
    if (fs3.existsSync(configPath)) {
      const raw = fs3.readFileSync(configPath, "utf-8");
      config = JSON.parse(raw);
    }
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers["unerr"] = {
      url: `${serverUrl}/api/mcp/sse`,
      env: apiKey ? { UNERR_API_KEY: apiKey } : {}
    };
    fs3.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}
function registerConfigVerifyCommand(program2) {
  const configCmd = program2.command("config").description("Manage unerr configuration");
  configCmd.command("verify").description("Check and optionally repair MCP configuration for IDEs").option("--silent", "Only output errors").option("--repair", "Automatically repair misconfigured IDEs").option("--ide <ide>", "Check specific IDE (vscode, cursor, windsurf)").action(async (opts) => {
    const unerrConfig = loadConfig3();
    const serverUrl = unerrConfig?.serverUrl ?? process.env.UNERR_SERVER_URL ?? "http://localhost:3000";
    const idesToCheck = opts.ide ? { [opts.ide]: IDE_CONFIG_PATHS[opts.ide] ?? "" } : IDE_CONFIG_PATHS;
    let allGood = true;
    for (const [ideName, configPath] of Object.entries(idesToCheck)) {
      if (!configPath) {
        if (!opts.silent) console.log(`  Unknown IDE: ${ideName}`);
        continue;
      }
      const result = checkIdeConfig(ideName, configPath, serverUrl);
      if (result.configured && result.issues.length === 0) {
        if (!opts.silent) console.log(`  \u2713 ${ideName}: configured correctly`);
      } else {
        allGood = false;
        for (const issue of result.issues) {
          console.log(`  \u2717 ${issue}`);
        }
        if (opts.repair) {
          const repaired = repairIdeConfig(ideName, configPath, serverUrl);
          if (repaired) {
            console.log(`  \u2713 ${ideName}: repaired`);
          } else {
            console.log(`  \u2717 ${ideName}: repair failed`);
          }
        }
      }
    }
    if (!allGood && !opts.repair) {
      console.log("\n  Run with --repair to fix issues automatically.");
    }
    if (allGood && !opts.silent) {
      console.log("\n  All IDE configurations look good!");
    }
  });
  configCmd.command("install-hooks").description("Install git hooks for automatic MCP config verification").action(async () => {
    const gitDir = path3.join(process.cwd(), ".git");
    if (!fs3.existsSync(gitDir)) {
      console.error("Not a git repository");
      process.exit(1);
    }
    const hooksDir = path3.join(gitDir, "hooks");
    if (!fs3.existsSync(hooksDir)) {
      fs3.mkdirSync(hooksDir, { recursive: true });
    }
    const hookScript = `#!/bin/sh
# unerr auto-verify MCP config
if command -v unerr &> /dev/null; then
  unerr config verify --silent 2>/dev/null || true
fi
`;
    for (const hookName of ["post-checkout", "post-merge"]) {
      const hookPath = path3.join(hooksDir, hookName);
      if (fs3.existsSync(hookPath)) {
        const existing = fs3.readFileSync(hookPath, "utf-8");
        if (existing.includes("unerr config verify")) {
          console.log(`  \u2713 ${hookName}: already installed`);
          continue;
        }
        fs3.appendFileSync(hookPath, "\n" + hookScript);
      } else {
        fs3.writeFileSync(hookPath, hookScript);
        fs3.chmodSync(hookPath, "755");
      }
      console.log(`  \u2713 ${hookName}: installed`);
    }
  });
}

// src/commands/connect.ts
import { execSync } from "child_process";
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
import { join as join4 } from "path";
function detectGitContext() {
  try {
    const { execSync: execSync2 } = __require("child_process");
    const remote = execSync2("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const branch = execSync2("git branch --show-current", {
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
  if (existsSync4(join4(cwd, ".cursor"))) return "cursor";
  if (existsSync4(join4(cwd, ".vscode"))) return "vscode";
  return "unknown";
}
function writeMcpConfig(ide, serverUrl, apiKey, repoName) {
  const cwd = process.cwd();
  if (ide === "cursor") {
    const configDir = join4(cwd, ".cursor");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join4(configDir, "mcp.json");
    let config = {};
    if (existsSync4(configPath)) {
      try {
        config = JSON.parse(readFileSync4(configPath, "utf-8"));
      } catch {
      }
    }
    const mcpServers = config.mcpServers ?? {};
    mcpServers["unerr"] = {
      url: `${serverUrl}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    };
    config.mcpServers = mcpServers;
    writeFileSync2(configPath, JSON.stringify(config, null, 2));
    console.log(`  Written: .cursor/mcp.json`);
  } else if (ide === "vscode") {
    const configDir = join4(cwd, ".vscode");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join4(configDir, "settings.json");
    let settings = {};
    if (existsSync4(configPath)) {
      try {
        settings = JSON.parse(readFileSync4(configPath, "utf-8"));
      } catch {
      }
    }
    const mcpServers = settings["mcp.servers"] ?? {};
    mcpServers["unerr"] = {
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
  console.log(`  claude mcp add unerr --transport http "${serverUrl}/mcp" \\`);
  console.log(`    --header "Authorization: Bearer ${apiKey}"`);
  console.log("");
  console.log(`  MCP configured for ${repoName}.`);
}
function registerConnectCommand(program2) {
  program2.command("connect").description("Connect current repo to unerr MCP (auth + detect + configure)").option("--server <url>", "Server URL", "https://app.unerr.dev").option("--key <apiKey>", "API key (skip browser login)").option("--ide <type>", "IDE type: cursor, vscode, claude-code").option("--ephemeral", "Create an ephemeral sandbox (expires in 4 hours)").action(
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
      const git2 = detectGitContext();
      if (!git2) {
        console.log("");
        console.log(
          "No git repository detected. Run this command from inside a git repo."
        );
        process.exit(1);
      }
      console.log(`  Repository: ${git2.fullName}`);
      console.log(`  Branch: ${git2.branch}`);
      console.log("");
      console.log("Checking unerr...");
      if (opts.ephemeral) {
        try {
          const initRes = await fetch(`${serverUrl}/api/cli/init`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${creds.apiKey}`
            },
            body: JSON.stringify({
              name: git2.repo,
              fullName: git2.fullName,
              branch: git2.branch,
              ephemeral: true
            })
          });
          if (initRes.ok) {
            console.log(
              "  Ephemeral sandbox created (expires in 4 hours). Use `unerr promote` to make permanent."
            );
          } else {
            const body = await initRes.json();
            console.error(`  Failed to create ephemeral sandbox: ${body.error ?? initRes.statusText}`);
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`  Error creating ephemeral sandbox: ${message}`);
          process.exit(1);
        }
      } else {
        try {
          const contextRes = await fetch(
            `${serverUrl}/api/cli/context?remote=${encodeURIComponent(git2.remote)}`,
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
              "  This repo isn't on unerr yet."
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
      }
      const ide = opts.ide ?? detectIde();
      console.log("");
      console.log(
        `Configuring MCP${ide !== "unknown" ? ` for ${ide}` : ""}...`
      );
      writeMcpConfig(ide, serverUrl, creds.apiKey, git2.fullName);
      try {
        const gitDir = execSync("git rev-parse --git-dir", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"]
        }).trim();
        const hooksDir = join4(gitDir, "hooks");
        mkdirSync2(hooksDir, { recursive: true });
        const hookScript = `#!/bin/sh
unerr config verify --silent 2>/dev/null || true
`;
        for (const hook of ["post-checkout", "post-merge"]) {
          const hookPath = join4(hooksDir, hook);
          if (!existsSync4(hookPath)) {
            writeFileSync2(hookPath, hookScript, { mode: 493 });
            console.log(`  Installed ${hook} hook for config verification.`);
          }
        }
      } catch {
      }
    }
  );
}

// src/commands/init.ts
import * as fs4 from "fs";
import * as path4 from "path";
function registerInitCommand(program2) {
  program2.command("init").description("Register this local repository with unerr server").option("--server <url>", "Server URL", process.env.UNERR_SERVER_URL ?? "http://localhost:3000").option("--branch <branch>", "Default branch", "main").option("--ephemeral", "Create an ephemeral sandbox (expires in 4 hours)").action(async (opts) => {
    try {
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const cwd = process.cwd();
      const repoName = path4.basename(cwd);
      console.log(`Registering ${repoName} with unerr server...`);
      const res = await fetch(`${opts.server}/api/cli/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`
        },
        body: JSON.stringify({
          name: repoName,
          fullName: repoName,
          branch: opts.branch,
          ...opts.ephemeral && { ephemeral: true }
        })
      });
      if (!res.ok) {
        const body = await res.json();
        console.error(`Failed: ${body.error ?? res.statusText}`);
        process.exit(1);
      }
      const result = await res.json();
      const unerrDir = path4.join(cwd, ".unerr");
      if (!fs4.existsSync(unerrDir)) {
        fs4.mkdirSync(unerrDir, { recursive: true });
      }
      const config = {
        repoId: result.repoId,
        serverUrl: opts.server,
        orgId: result.orgId,
        branch: opts.branch
      };
      fs4.writeFileSync(
        path4.join(unerrDir, "config.json"),
        JSON.stringify(config, null, 2) + "\n"
      );
      const gitignorePath = path4.join(cwd, ".gitignore");
      if (fs4.existsSync(gitignorePath)) {
        const content = fs4.readFileSync(gitignorePath, "utf-8");
        if (!content.includes(".unerr")) {
          fs4.appendFileSync(gitignorePath, "\n# unerr local config\n.unerr/\n");
        }
      } else {
        fs4.writeFileSync(gitignorePath, "# unerr local config\n.unerr/\n");
      }
      console.log(`Registered repo: ${repoName} (${result.repoId})`);
      console.log(`  Config: .unerr/config.json`);
      if (opts.ephemeral) {
        console.log(`  Ephemeral sandbox created (expires in 4 hours). Use \`unerr promote\` to make permanent.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/mark-working.ts
import * as fs5 from "fs";
import * as path5 from "path";
function loadConfig4() {
  const configPath = path5.join(process.cwd(), ".unerr", "config.json");
  if (!fs5.existsSync(configPath)) return null;
  return JSON.parse(fs5.readFileSync(configPath, "utf-8"));
}
function registerMarkWorkingCommand(program2) {
  program2.command("mark-working <entry-id>").description("Mark a ledger entry as a known-good working state").action(async (entryId) => {
    try {
      const config = loadConfig4();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const res = await fetch(
        `${config.serverUrl}/api/repos/${config.repoId}/timeline/mark-working`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`
          },
          body: JSON.stringify({ entryId, files: [] })
        }
      );
      if (!res.ok) {
        const body = await res.json();
        console.error(`Failed: ${body.error ?? res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      console.log(`Marked entry ${entryId} as working`);
      console.log(`  Snapshot: ${data.snapshotId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/promote.ts
import * as fs6 from "fs";
import * as path6 from "path";
function loadConfig5() {
  const configPath = path6.join(process.cwd(), ".unerr", "config.json");
  if (!fs6.existsSync(configPath)) return null;
  return JSON.parse(fs6.readFileSync(configPath, "utf-8"));
}
function registerPromoteCommand(program2) {
  program2.command("promote").description("Convert ephemeral sandbox to permanent repository").action(async () => {
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run `unerr auth login` first.");
      process.exit(1);
    }
    const config = loadConfig5();
    if (!config?.repoId) {
      console.error(
        "No repo configured. Run `unerr init` or `unerr connect` first."
      );
      process.exit(1);
    }
    try {
      const serverUrl = config.serverUrl || creds.serverUrl;
      const res = await fetch(
        `${serverUrl}/api/repos/${config.repoId}/promote`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (!res.ok) {
        const body = await res.json();
        console.error(
          `Failed to promote: ${body.error ?? res.statusText}`
        );
        process.exit(1);
      }
      console.log(
        "Repository promoted to permanent. Ephemeral expiry removed."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/pull.ts
import { createHash } from "crypto";
import { existsSync as existsSync8, mkdirSync as mkdirSync4, readFileSync as readFileSync8, writeFileSync as writeFileSync4 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join8 } from "path";
import { gunzipSync } from "zlib";
var UNERR_DIR = join8(homedir2(), ".unerr");
var SNAPSHOTS_DIR = join8(UNERR_DIR, "snapshots");
var MANIFESTS_DIR = join8(UNERR_DIR, "manifests");
function getManifest(repoId) {
  const path11 = join8(MANIFESTS_DIR, `${repoId}.json`);
  if (!existsSync8(path11)) return null;
  try {
    return JSON.parse(readFileSync8(path11, "utf-8"));
  } catch {
    return null;
  }
}
function registerPullCommand(program2) {
  program2.command("pull").description("Download graph snapshot for a repo").requiredOption("--repo <repoId>", "Repository ID").option("--force", "Force re-download even if up to date").action(async (opts) => {
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run: unerr auth login");
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
    mkdirSync4(SNAPSHOTS_DIR, { recursive: true });
    mkdirSync4(MANIFESTS_DIR, { recursive: true });
    const snapshotPath = join8(SNAPSHOTS_DIR, `${repoId}.msgpack.gz`);
    writeFileSync4(snapshotPath, buffer);
    let ruleCount = 0;
    let patternCount = 0;
    let snapshotVersion = 1;
    try {
      const decompressed = gunzipSync(buffer);
      const { unpack } = await import("msgpackr");
      const envelope = unpack(decompressed);
      snapshotVersion = envelope.version ?? 1;
      ruleCount = envelope.rules?.length ?? 0;
      patternCount = envelope.patterns?.length ?? 0;
    } catch {
    }
    const manifest = {
      repoId,
      checksum,
      sizeBytes: buffer.length,
      entityCount,
      edgeCount,
      ruleCount,
      patternCount,
      snapshotVersion,
      generatedAt,
      pulledAt: (/* @__PURE__ */ new Date()).toISOString(),
      snapshotPath
    };
    writeFileSync4(join8(MANIFESTS_DIR, `${repoId}.json`), JSON.stringify(manifest, null, 2));
    const v2Info = snapshotVersion >= 2 ? `, ${ruleCount} rules, ${patternCount} patterns` : "";
    console.log(`Done! ${entityCount} entities, ${edgeCount} edges${v2Info}`);
    console.log(`Saved to ${snapshotPath}`);
  });
}

// src/commands/push.ts
import * as fs7 from "fs";
import * as path7 from "path";
function loadConfig6() {
  const configPath = path7.join(process.cwd(), ".unerr", "config.json");
  if (!fs7.existsSync(configPath)) return null;
  const raw = fs7.readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}
function registerPushCommand(program2) {
  program2.command("push").description("Upload local repository for indexing").option("--local-parse", "Use local AST extraction (requires unerr-parse binary)").action(async (_opts) => {
    try {
      let walkDir2 = function(dir, relativeTo) {
        const entries = fs7.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path7.join(dir, entry.name);
          const relPath = path7.relative(relativeTo, fullPath);
          if (ig.ignores(relPath)) continue;
          if (entry.isDirectory()) {
            walkDir2(fullPath, relativeTo);
          } else if (entry.isFile()) {
            archive.file(fullPath, { name: relPath });
          }
        }
      };
      var walkDir = walkDir2;
      const config = loadConfig6();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      console.log("Preparing upload...");
      const uploadRes = await fetch(`${config.serverUrl}/api/cli/index`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`
        },
        body: JSON.stringify({
          phase: "request_upload",
          repoId: config.repoId
        })
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        console.error(`Upload request failed: ${body.error ?? uploadRes.statusText}`);
        process.exit(1);
      }
      const { uploadUrl, uploadPath } = await uploadRes.json();
      const archiver = (await import("archiver")).default;
      const ig = await createIgnoreFilter(process.cwd());
      const archive = archiver("zip", { zlib: { level: 6 } });
      const chunks = [];
      archive.on("data", (chunk) => chunks.push(chunk));
      walkDir2(process.cwd(), process.cwd());
      await archive.finalize();
      await new Promise((resolve) => archive.on("end", resolve));
      const zipBuffer = Buffer.concat(chunks);
      console.log(`Uploading ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB...`);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        body: zipBuffer
      });
      if (!putRes.ok) {
        console.error(`Upload failed: ${putRes.statusText}`);
        process.exit(1);
      }
      const triggerRes = await fetch(`${config.serverUrl}/api/cli/index`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`
        },
        body: JSON.stringify({
          phase: "trigger_index",
          repoId: config.repoId,
          uploadPath
        })
      });
      if (!triggerRes.ok) {
        const body = await triggerRes.json();
        console.error(`Index trigger failed: ${body.error ?? triggerRes.statusText}`);
        process.exit(1);
      }
      const triggerResult = await triggerRes.json();
      console.log(`Indexing started (workflow: ${triggerResult.workflowId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/rewind.ts
import * as fs8 from "fs";
import * as path8 from "path";
function loadConfig7() {
  const configPath = path8.join(process.cwd(), ".unerr", "config.json");
  if (!fs8.existsSync(configPath)) return null;
  return JSON.parse(fs8.readFileSync(configPath, "utf-8"));
}
function registerRewindCommand(program2) {
  program2.command("rewind <entry-id>").description("Rewind to a previous working state").option("--dry-run", "Only show blast radius without making changes").action(async (entryId, opts) => {
    try {
      const config = loadConfig7();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const res = await fetch(`${config.serverUrl}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`
        },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "revert_to_working_state",
            arguments: { target_entry_id: entryId, dry_run: opts.dryRun ?? false }
          }
        })
      });
      const result = await res.json();
      const text = result.content?.[0]?.text;
      if (!text) {
        console.error("Unexpected response");
        process.exit(1);
      }
      const data = JSON.parse(text);
      if (opts.dryRun) {
        console.log("\nDry Run \u2014 Blast Radius:");
        const br = data.blastRadius;
        console.log(`  Safe files: ${(br.safeFiles ?? []).length}`);
        console.log(`  Conflicted: ${(br.conflictedFiles ?? []).length}`);
        console.log(`  At risk: ${(br.manualChangesAtRisk ?? []).length}`);
        if ((br.conflictedFiles ?? []).length > 0) {
          console.log("\n  Conflicted files:");
          for (const f of br.conflictedFiles ?? []) {
            console.log(`    - ${f.filePath}`);
          }
        }
      } else {
        console.log(`Reverted to entry ${entryId}`);
        console.log(`  Timeline branch: ${data.timelineBranch}`);
        console.log(`  Entries reverted: ${data.entriesReverted}`);
        console.log(`  Rewind entry: ${data.rewindEntryId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/serve.ts
import { existsSync as existsSync11, readdirSync as readdirSync2, readFileSync as readFileSync11 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join11 } from "path";
import { gunzipSync as gunzipSync2 } from "zlib";

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
var UNERR_DIR2 = join11(homedir3(), ".unerr");
var SNAPSHOTS_DIR2 = join11(UNERR_DIR2, "snapshots");
var MANIFESTS_DIR2 = join11(UNERR_DIR2, "manifests");
function registerServeCommand(program2) {
  program2.command("serve").description("Start local MCP server").option("--repo <repoId>", "Specific repo to serve (default: all pulled repos)").option("--prefetch", "Enable predictive context pre-fetching (default: false)").option("--no-prefetch", "Disable predictive context pre-fetching").action(async (opts) => {
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run: unerr auth login");
      process.exit(1);
    }
    let repoIds = [];
    if (opts.repo) {
      repoIds = [opts.repo];
    } else {
      if (existsSync11(MANIFESTS_DIR2)) {
        repoIds = readdirSync2(MANIFESTS_DIR2).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
      }
    }
    if (repoIds.length === 0) {
      console.error("No snapshots found. Run: unerr pull --repo <repoId>");
      process.exit(1);
    }
    for (const repoId of repoIds) {
      const info = getStalenessInfo(repoId);
      if (info.isStale) {
        console.warn(`Warning: Snapshot for ${repoId} is ${info.ageHours}h old (stale). Run: unerr pull --repo ${repoId}`);
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
    const { CozoGraphStore } = await import("./local-graph-UWWPEX27.js");
    const localGraph = new CozoGraphStore(db);
    for (const repoId of repoIds) {
      const manifest = getManifest(repoId);
      if (!manifest) {
        console.warn(`No manifest for ${repoId}, skipping`);
        continue;
      }
      let snapshotPath = join11(SNAPSHOTS_DIR2, `${repoId}.msgpack.gz`);
      if (!existsSync11(snapshotPath)) {
        snapshotPath = join11(SNAPSHOTS_DIR2, `${repoId}.msgpack`);
      }
      if (!existsSync11(snapshotPath)) {
        console.warn(`Snapshot file not found for ${repoId}, skipping`);
        continue;
      }
      console.log(`Loading snapshot for ${repoId}...`);
      const { unpack } = await import("msgpackr");
      const raw = readFileSync11(snapshotPath);
      const buffer = snapshotPath.endsWith(".gz") ? gunzipSync2(raw) : raw;
      const envelope = unpack(buffer);
      localGraph.loadSnapshot(envelope);
      console.log(`Loaded ${manifest.entityCount} entities, ${manifest.edgeCount} edges`);
    }
    const { CloudProxy } = await import("./cloud-proxy-OYOBTZTT.js");
    const cloudProxy = new CloudProxy({
      serverUrl: creds.serverUrl,
      apiKey: creds.apiKey
    });
    let ruleEvaluator;
    try {
      const ruleEvalModule = await import("./rule-evaluator-PB46ITLW.js");
      ruleEvaluator = ruleEvalModule.evaluateRules;
    } catch {
      console.warn("Rule evaluator not available \u2014 check_rules will use cloud fallback");
    }
    const { QueryRouter } = await import("./query-router-QW6NGQFQ.js");
    const router = new QueryRouter(localGraph, cloudProxy, ruleEvaluator);
    let prefetchManager = null;
    if (opts.prefetch) {
      const { PrefetchManager } = await import("./prefetch-UT52MZQS.js");
      prefetchManager = new PrefetchManager({
        serverUrl: creds.serverUrl,
        apiKey: creds.apiKey
      });
      console.log("Prefetch enabled \u2014 predictive context pre-warming active");
    }
    console.log("Starting MCP server on stdio...");
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = new Server(
      { name: "unerr-local", version: "0.1.0" },
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
      { name: "sync_local_diff", description: "Sync local changes (cloud)", inputSchema: { type: "object", properties: { diff: { type: "string" } }, required: ["diff"] } },
      { name: "get_rules", description: "Get applicable rules for a file path", inputSchema: { type: "object", properties: { file_path: { type: "string", description: "Optional file path to filter rules by glob" } } } },
      { name: "check_rules", description: "Check rules against file content (structural + naming, local evaluation)", inputSchema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } }
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
        if (prefetchManager && args.file_path && repoIds.length > 0) {
          prefetchManager.onCursorChange({
            filePath: args.file_path,
            entityKey: args.key,
            repoId: repoIds[0]
          });
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result.content, null, 2) }],
          _meta: result._meta
        };
      }
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    if (prefetchManager) {
      process.on("SIGINT", () => {
        prefetchManager?.dispose();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        prefetchManager?.dispose();
        process.exit(0);
      });
    }
    const ruleInfo = localGraph.hasRules() ? ` (${localGraph.getRules().length} rules loaded)` : "";
    console.error(`unerr MCP server running on stdio \u2014 13 tools (9 local, 4 cloud)${ruleInfo}`);
  });
}

// src/commands/sync.ts
import { createHash as createHash2 } from "crypto";
import { existsSync as existsSync12, mkdirSync as mkdirSync5, readFileSync as readFileSync12 } from "fs";
import { join as join12, relative as relative2 } from "path";
import git from "isomorphic-git";
import fs9 from "fs";
var _httpClient = null;
function getHttpClient() {
  if (!_httpClient) {
    _httpClient = __require("isomorphic-git/http/node");
  }
  return _httpClient;
}
function loadProjectConfig(cwd) {
  const configPath = join12(cwd, ".unerr", "config.json");
  if (!existsSync12(configPath)) return null;
  try {
    return JSON.parse(readFileSync12(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function deriveKeyId(apiKey) {
  return createHash2("sha256").update(apiKey).digest("hex").slice(0, 12);
}
async function collectSyncFiles(cwd) {
  const ignore = await createIgnoreFilter(cwd);
  const files = [];
  function walk(dir) {
    const entries = fs9.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join12(dir, entry.name);
      const relPath = relative2(cwd, fullPath);
      if (entry.name === ".unerr" || entry.name === ".git") continue;
      if (ignore.ignores(relPath)) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }
  walk(cwd);
  return files;
}
async function ensureGitDir(cwd, serverUrl, orgId, repoId) {
  const gitdir = join12(cwd, ".unerr", "git");
  if (!existsSync12(join12(gitdir, "HEAD"))) {
    mkdirSync5(gitdir, { recursive: true });
    await git.init({ fs: fs9, dir: cwd, gitdir });
    const remoteUrl = `${serverUrl}/api/git/${orgId}/${repoId}`;
    await git.addRemote({ fs: fs9, dir: cwd, gitdir, remote: "origin", url: remoteUrl });
  }
  return gitdir;
}
async function runSync(cwd, gitdir, apiKey, keyId, verbose) {
  const files = await collectSyncFiles(cwd);
  if (files.length === 0) {
    if (verbose) console.log("  No files to sync");
    return false;
  }
  if (verbose) console.log(`  Staging ${files.length} files...`);
  for (const filepath of files) {
    try {
      await git.add({ fs: fs9, dir: cwd, gitdir, filepath });
    } catch {
    }
  }
  const matrix = await git.statusMatrix({ fs: fs9, dir: cwd, gitdir });
  const changed = matrix.filter(([, head, workdir, stage]) => {
    return head !== workdir || head !== stage;
  });
  if (changed.length === 0) {
    if (verbose) console.log("  No changes detected");
    return false;
  }
  for (const [filepath, head, ,] of changed) {
    try {
      if (head === 0) {
      } else {
        const fullPath = join12(cwd, filepath);
        if (existsSync12(fullPath)) {
          await git.add({ fs: fs9, dir: cwd, gitdir, filepath });
        } else {
          await git.remove({ fs: fs9, dir: cwd, gitdir, filepath });
        }
      }
    } catch {
    }
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sha = await git.commit({
    fs: fs9,
    dir: cwd,
    gitdir,
    message: `workspace sync ${timestamp}`,
    author: { name: "unerr-cli", email: "cli@unerr.dev" }
  });
  if (verbose) console.log(`  Committed ${sha.slice(0, 8)} (${changed.length} changes)`);
  const ref = `refs/unerr/ws/${keyId}`;
  try {
    const pushResult = await git.push({
      fs: fs9,
      http: getHttpClient(),
      dir: cwd,
      gitdir,
      remote: "origin",
      ref: `HEAD:${ref}`,
      force: true,
      onAuth: () => ({ username: "x-token", password: apiKey })
    });
    if (pushResult.ok) {
      console.log(`  Pushed ${sha.slice(0, 8)} \u2192 ${ref} (${changed.length} files changed)`);
    } else {
      const errors = pushResult.refs ? Object.entries(pushResult.refs).filter(([, v]) => v && typeof v === "object" && "error" in v) : [];
      if (errors.length > 0) {
        console.error("  Push failed:", JSON.stringify(errors));
        return false;
      }
      console.log(`  Pushed ${sha.slice(0, 8)} \u2192 ${ref}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      console.error("  Authentication failed. Run `unerr auth login` to re-authenticate.");
    } else {
      console.error(`  Push failed: ${msg}`);
    }
    return false;
  }
  return true;
}
function registerSyncCommand(program2) {
  program2.command("sync").description("Sync workspace to unerr server").option("-w, --watch", "Watch for changes and sync continuously").option("-v, --verbose", "Show detailed output").action(async (opts) => {
    const cwd = process.cwd();
    const config = loadProjectConfig(cwd);
    if (!config) {
      console.error("No .unerr/config.json found. Run `unerr init` first.");
      process.exit(1);
    }
    const creds = getCredentials();
    if (!creds) {
      console.error("Not authenticated. Run `unerr auth login` first.");
      process.exit(1);
    }
    const serverUrl = config.serverUrl || creds.serverUrl;
    const apiKey = creds.apiKey;
    const keyId = deriveKeyId(apiKey);
    const gitdir = await ensureGitDir(cwd, serverUrl, config.orgId, config.repoId);
    if (opts.watch) {
      await runWatchMode(cwd, gitdir, apiKey, keyId, opts.verbose ?? false);
    } else {
      console.log("Syncing workspace...");
      const pushed = await runSync(cwd, gitdir, apiKey, keyId, opts.verbose ?? false);
      if (!pushed) {
        console.log("Workspace is up to date.");
      }
    }
  });
}
async function runWatchMode(cwd, gitdir, apiKey, keyId, verbose) {
  const chokidar = await import("chokidar");
  const ignore = await createIgnoreFilter(cwd);
  console.log("Watching for changes... (Ctrl+C to stop)");
  await runSync(cwd, gitdir, apiKey, keyId, verbose);
  let debounceTimer = null;
  let syncInProgress = false;
  let pendingSync = false;
  const triggerSync = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (syncInProgress) {
        pendingSync = true;
        return;
      }
      syncInProgress = true;
      try {
        await runSync(cwd, gitdir, apiKey, keyId, verbose);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  Sync error: ${msg}`);
      } finally {
        syncInProgress = false;
        if (pendingSync) {
          pendingSync = false;
          triggerSync();
        }
      }
    }, 2e3);
  };
  const watcher = chokidar.watch(cwd, {
    ignored: (filePath) => {
      const rel = relative2(cwd, filePath);
      if (!rel || rel === ".") return false;
      if (rel.startsWith(".unerr") || rel.startsWith(".git")) return true;
      return ignore.ignores(rel);
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });
  watcher.on("add", triggerSync);
  watcher.on("change", triggerSync);
  watcher.on("unlink", triggerSync);
  const shutdown = () => {
    console.log("\nStopping watch mode...");
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {
  });
}

// src/commands/timeline.ts
import * as fs10 from "fs";
import * as path9 from "path";
function loadConfig8() {
  const configPath = path9.join(process.cwd(), ".unerr", "config.json");
  if (!fs10.existsSync(configPath)) return null;
  return JSON.parse(fs10.readFileSync(configPath, "utf-8"));
}
function registerTimelineCommand(program2) {
  program2.command("timeline").description("Show the prompt ledger timeline").option("--branch <branch>", "Filter by branch").option("--status <status>", "Filter by status (pending|working|broken|committed|reverted)").option("--limit <n>", "Number of entries to show", "20").action(async (opts) => {
    try {
      const config = loadConfig8();
      if (!config) {
        console.error("Not initialized. Run: unerr init");
        process.exit(1);
      }
      const creds = getCredentials();
      if (!creds?.apiKey) {
        console.error("Not authenticated. Run: unerr auth login");
        process.exit(1);
      }
      const params = new URLSearchParams();
      if (opts.branch) params.set("branch", opts.branch);
      if (opts.status) params.set("status", opts.status);
      params.set("limit", opts.limit);
      const res = await fetch(
        `${config.serverUrl}/api/repos/${config.repoId}/timeline?${params.toString()}`,
        { headers: { Authorization: `Bearer ${creds.apiKey}` } }
      );
      if (!res.ok) {
        console.error(`Failed: ${res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      if (data.items.length === 0) {
        console.log("No ledger entries found.");
        return;
      }
      const STATUS_ICONS = {
        working: "\u25CF",
        broken: "\u2717",
        pending: "\u25CB",
        committed: "\u25C6",
        reverted: "\u21A9"
      };
      console.log("\n  ID                                   Status     Branch        Prompt");
      console.log("  " + "\u2500".repeat(90));
      for (const entry of data.items) {
        const icon = STATUS_ICONS[entry.status] ?? "?";
        const prompt = entry.prompt.slice(0, 40).padEnd(40);
        const status = `${icon} ${entry.status}`.padEnd(12);
        const branch = `${entry.branch}#${entry.timeline_branch}`.padEnd(14);
        console.log(`  ${entry.id.slice(0, 36)}   ${status} ${branch} ${prompt}`);
      }
      if (data.hasMore) {
        console.log(`
  ... more entries available (use --limit to see more)`);
      }
      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// src/commands/watch.ts
import * as fs11 from "fs";
import * as path10 from "path";
function loadConfig9() {
  const configPath = path10.join(process.cwd(), ".unerr", "config.json");
  if (!fs11.existsSync(configPath)) return null;
  return JSON.parse(fs11.readFileSync(configPath, "utf-8"));
}
function registerWatchCommand(program2) {
  program2.command("watch").description("Watch for file changes and sync to unerr server").option("--debounce <ms>", "Debounce interval in ms", "2000").action(async (opts) => {
    const config = loadConfig9();
    if (!config) {
      console.error("Not initialized. Run: unerr init");
      process.exit(1);
    }
    const creds = getCredentials();
    if (!creds?.apiKey) {
      console.error("Not authenticated. Run: unerr auth login");
      process.exit(1);
    }
    const debounceMs = parseInt(opts.debounce, 10);
    let debounceTimer = null;
    const changedFiles = /* @__PURE__ */ new Set();
    console.log(`Watching for changes (debounce: ${debounceMs}ms)...`);
    console.log("Press Ctrl+C to stop.\n");
    const chokidar = await import("chokidar");
    const ig = await createIgnoreFilter(process.cwd());
    const watcher = chokidar.watch(process.cwd(), {
      ignored: (filePath) => {
        const rel = path10.relative(process.cwd(), filePath);
        if (!rel) return false;
        return ig.ignores(rel);
      },
      persistent: true,
      ignoreInitial: true
    });
    async function syncChanges() {
      if (changedFiles.size === 0) return;
      const files = Array.from(changedFiles);
      changedFiles.clear();
      console.log(`Syncing ${files.length} changed file(s)...`);
      try {
        const { execSync: execSync2 } = await import("child_process");
        const diff = execSync2(
          `git diff -- ${files.map((f) => `"${f}"`).join(" ")}`,
          { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 }
        );
        if (!diff.trim()) {
          console.log("  No diff to sync (changes may be staged)");
          return;
        }
        const res = await fetch(`${config.serverUrl}/api/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`
          },
          body: JSON.stringify({
            method: "tools/call",
            params: {
              name: "sync_local_diff",
              arguments: { diff }
            }
          })
        });
        if (res.ok) {
          console.log(`  Synced ${files.length} file(s)`);
        } else {
          console.error(`  Sync failed: ${res.statusText}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  Sync error: ${message}`);
      }
    }
    watcher.on("change", (filePath) => {
      const rel = path10.relative(process.cwd(), filePath);
      changedFiles.add(rel);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void syncChanges();
      }, debounceMs);
    });
    watcher.on("add", (filePath) => {
      const rel = path10.relative(process.cwd(), filePath);
      changedFiles.add(rel);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void syncChanges();
      }, debounceMs);
    });
    const configCheckInterval = setInterval(async () => {
      try {
        const configPath = path10.join(process.cwd(), ".unerr", "config.json");
        if (!fs11.existsSync(configPath)) return;
        const unerrConfig = JSON.parse(
          fs11.readFileSync(configPath, "utf-8")
        );
        const serverUrl = unerrConfig.serverUrl ?? "http://localhost:3000";
        const cwd = process.cwd();
        const ideConfigs = [
          { name: "cursor", path: path10.join(cwd, ".cursor", "mcp.json"), key: "mcpServers" },
          { name: "vscode", path: path10.join(cwd, ".vscode", "settings.json"), key: "mcp.servers" }
        ];
        for (const ide of ideConfigs) {
          if (!fs11.existsSync(ide.path)) continue;
          try {
            const raw = fs11.readFileSync(ide.path, "utf-8");
            const parsed = JSON.parse(raw);
            const servers = ide.key === "mcpServers" ? parsed.mcpServers : parsed["mcp.servers"];
            if (servers && !servers["unerr"]) {
              console.log(
                `[config] MCP config drift detected in ${ide.name}, auto-repairing...`
              );
              servers["unerr"] = {
                url: `${serverUrl}/mcp`,
                headers: {
                  Authorization: `Bearer ${creds.apiKey}`
                }
              };
              if (ide.key === "mcpServers") {
                parsed.mcpServers = servers;
              } else {
                parsed["mcp.servers"] = servers;
              }
              fs11.writeFileSync(ide.path, JSON.stringify(parsed, null, 2));
              console.log(`[config] Repaired ${ide.name} MCP config.`);
            }
          } catch {
          }
        }
      } catch {
      }
    }, 6e4);
    process.on("SIGINT", () => {
      console.log("\nStopping watcher...");
      clearInterval(configCheckInterval);
      void watcher.close();
      process.exit(0);
    });
  });
}

// src/index.ts
var program = new Command();
program.name("unerr").description("Code intelligence for AI agents").version("0.1.0").option("--server <url>", "Server URL").option("--key <apiKey>", "API key (skip browser login)").option("--ide <type>", "IDE type: cursor, vscode, claude-code, windsurf").action(async (opts) => {
  const { runSetup } = await import("./setup-ZWBTQDXA.js");
  await runSetup({ server: opts.server, key: opts.key, ide: opts.ide });
});
registerAuthCommand(program);
registerBranchesCommand(program);
registerCircuitResetCommand(program);
registerConfigVerifyCommand(program);
registerConnectCommand(program);
registerInitCommand(program);
registerMarkWorkingCommand(program);
registerPromoteCommand(program);
registerPushCommand(program);
registerPullCommand(program);
registerRewindCommand(program);
registerServeCommand(program);
registerSyncCommand(program);
registerTimelineCommand(program);
registerWatchCommand(program);
program.parse();
