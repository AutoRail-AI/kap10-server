import {
  deviceAuthFlow,
  getCredentials,
  saveCredentials
} from "./chunk-T6GFTYJX.js";
import {
  __require
} from "./chunk-3RG5ZIWI.js";

// src/commands/setup.ts
import { existsSync as existsSync2, readFileSync, writeFileSync, mkdirSync as mkdirSync2, appendFileSync as appendFileSync2 } from "fs";
import { join as join3 } from "path";
import { execSync as execSync2 } from "child_process";

// src/utils/detect.ts
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
function classifyHost(remote) {
  const lower = remote.toLowerCase();
  if (lower.includes("github.com")) return "github";
  if (lower.includes("gitlab.com") || lower.includes("gitlab.")) return "gitlab";
  if (lower.includes("bitbucket.org") || lower.includes("bitbucket.")) return "bitbucket";
  return "other";
}
function parseRemote(remote) {
  const sshMatch = remote.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1] ?? null;
  const httpMatch = remote.match(/(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+?)(?:\.git)?$/);
  if (httpMatch) return httpMatch[1] ?? null;
  return null;
}
function detectGitContext() {
  try {
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
      fullName,
      host: classifyHost(remote)
    };
  } catch {
    return null;
  }
}
function isGitRepo() {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}
function detectIde(cwd) {
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  if (process.env.CLAUDE_CODE === "1" || process.env.CLAUDE_CODE === "true") return "claude-code";
  const termProgram = process.env.TERM_PROGRAM ?? "";
  if (termProgram === "vscode") {
    const cursorExtensions = process.env.VSCODE_CWD ?? "";
    if (cursorExtensions.toLowerCase().includes("cursor")) return "cursor";
  }
  try {
    const ppidChain = execSync("ps -o comm= -p $PPID 2>/dev/null || true", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (ppidChain.includes("claude")) return "claude-code";
  } catch {
  }
  if (existsSync(join(cwd, ".cursor"))) return "cursor";
  if (existsSync(join(cwd, ".windsurf"))) return "windsurf";
  if (termProgram === "vscode") return "vscode";
  if (existsSync(join(cwd, ".vscode"))) return "vscode";
  return "unknown";
}
function ideDisplayName(ide) {
  switch (ide) {
    case "cursor":
      return "Cursor";
    case "claude-code":
      return "Claude Code";
    case "vscode":
      return "VS Code";
    case "windsurf":
      return "Windsurf";
    case "unknown":
      return "your IDE";
  }
}
var IDE_CHOICES = [
  { title: "Cursor", value: "cursor" },
  { title: "Claude Code", value: "claude-code" },
  { title: "VS Code", value: "vscode" },
  { title: "Windsurf", value: "windsurf" }
];

// src/utils/ui.ts
import pc from "picocolors";
var brand = {
  name: "kap10",
  tagline: "Code intelligence for AI agents"
};
function banner() {
  console.log("");
  console.log(`  ${pc.bold(pc.cyan(brand.name))}  ${pc.dim(brand.tagline)}`);
  console.log("");
}
function section(label) {
  console.log(`  ${pc.cyan("\u25CF")} ${label}`);
}
function success(label) {
  console.log(`  ${pc.green("\u2713")} ${label}`);
}
function fail(label) {
  console.log(`  ${pc.red("\u2717")} ${label}`);
}
function info(label) {
  console.log(`    ${label}`);
}
function detail(label) {
  console.log(`    ${pc.dim(label)}`);
}
function warn(label) {
  console.log(`    ${pc.yellow(label)}`);
}
function blank() {
  console.log("");
}
function done(label) {
  console.log("");
  console.log(`  ${pc.green("\u2713")} ${pc.bold(pc.green(label))}`);
  console.log("");
}

// src/utils/log.ts
import { mkdirSync, appendFileSync } from "fs";
import { join as join2 } from "path";
var logFilePath = null;
function ensureLogDir(cwd) {
  const logsDir = join2(cwd, ".kap10", "logs");
  mkdirSync(logsDir, { recursive: true });
  return logsDir;
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function datestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function initLogFile(cwd) {
  const logsDir = ensureLogDir(cwd);
  logFilePath = join2(logsDir, `setup-${datestamp()}.log`);
  write("info", "=== kap10 setup started ===");
  write("info", `cwd: ${cwd}`);
  write("info", `node: ${process.version}`);
  write("info", `platform: ${process.platform} ${process.arch}`);
  return logFilePath;
}
function write(level, message, data) {
  if (!logFilePath) return;
  const line = data ? `[${timestamp()}] [${level}] ${message} ${JSON.stringify(data)}` : `[${timestamp()}] [${level}] ${message}`;
  try {
    appendFileSync(logFilePath, line + "\n");
  } catch {
  }
}
function logInfo(message, data) {
  write("info", message, data);
}
function logError(message, data) {
  write("error", message, data);
}
function logApi(method, url, status, body) {
  const statusStr = status !== void 0 ? ` \u2192 ${status}` : "";
  write("api", `${method} ${url}${statusStr}`, body);
}
function getLogFilePath() {
  return logFilePath;
}

// src/commands/setup.ts
var DEFAULT_SERVER = "https://app.kap10.dev";
async function stepAuthenticate(serverUrl, apiKey) {
  section("Authenticating...");
  const existing = getCredentials();
  if (existing && !apiKey) {
    logInfo("Using existing credentials", { serverUrl: existing.serverUrl, orgName: existing.orgName });
    success(`Authenticated as ${pc.bold(existing.orgName ?? existing.serverUrl)}`);
    return {
      serverUrl: existing.serverUrl,
      apiKey: existing.apiKey,
      orgId: existing.orgId,
      orgName: existing.orgName
    };
  }
  if (apiKey) {
    const creds = { serverUrl, apiKey };
    saveCredentials(creds);
    logInfo("API key saved");
    success("API key saved");
    return creds;
  }
  info("Opening browser for login...");
  logInfo("Starting device auth flow", { serverUrl });
  try {
    const creds = await deviceAuthFlow(serverUrl);
    saveCredentials(creds);
    logInfo("Device auth complete", { orgName: creds.orgName });
    success(`Authenticated as ${pc.bold(creds.orgName ?? "your organization")}`);
    return creds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("Authentication failed", { error: message });
    fail(`Authentication failed: ${message}`);
    process.exit(1);
  }
}
async function stepDetectIde(cwd) {
  section("Detecting coding agent...");
  const detected = detectIde(cwd);
  if (detected !== "unknown") {
    logInfo("IDE auto-detected", { ide: detected });
    success(`Detected ${pc.bold(ideDisplayName(detected))}`);
    return detected;
  }
  logInfo("IDE not auto-detected, prompting user");
  info("Could not auto-detect your coding agent.");
  blank();
  const prompts = (await import("prompts")).default;
  const response = await prompts({
    type: "select",
    name: "ide",
    message: "Which coding agent are you using?",
    choices: IDE_CHOICES.map((c) => ({ title: c.title, value: c.value }))
  });
  if (!response.ide) {
    logError("IDE selection cancelled");
    fail("Setup cancelled");
    process.exit(1);
  }
  const ide = response.ide;
  logInfo("IDE selected by user", { ide });
  success(`Selected ${pc.bold(ideDisplayName(ide))}`);
  return ide;
}
function stepDetectGit() {
  section("Detecting repository...");
  if (!isGitRepo()) {
    logInfo("Not a git repository");
    warn("Not inside a git repository.");
    info("You can still use kap10 with local upload (kap10 init + kap10 push).");
    return null;
  }
  const git = detectGitContext();
  if (!git) {
    logInfo("Git repo found but no remote origin");
    warn("Git repository found but no remote origin configured.");
    return null;
  }
  const hostLabel = git.host === "github" ? "GitHub" : git.host === "gitlab" ? "GitLab" : git.host === "bitbucket" ? "Bitbucket" : "Git";
  logInfo("Git context detected", { host: git.host, fullName: git.fullName, branch: git.branch });
  success(`${hostLabel} repo: ${pc.bold(git.fullName)} ${pc.dim(`(${git.branch})`)}`);
  return git;
}
async function stepCheckRepo(ctx) {
  section("Checking kap10...");
  if (!ctx.git) return null;
  try {
    const url = `${ctx.serverUrl}/api/cli/context?remote=${encodeURIComponent(ctx.git.remote)}`;
    logApi("GET", url);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    });
    logApi("GET", url, res.status);
    if (res.ok) {
      const data = await res.json();
      logInfo("Repo found on kap10", data);
      if (data.indexed) {
        success(`Already indexed: ${pc.bold(data.repoName)}`);
      } else {
        info(`Found: ${data.repoName} (${data.status})`);
        if (data.status === "indexing") {
          info("Repo is still indexing. MCP will work once indexing completes.");
        }
      }
      return { repoId: data.repoId, status: data.status, indexed: data.indexed };
    }
    if (res.status === 404) {
      logInfo("Repo not found on kap10");
      info("This repo isn't on kap10 yet.");
      return null;
    }
    logError("Unexpected status checking repo", { status: res.status });
    warn(`Could not check repo status (${res.status})`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("Failed to check repo", { error: message });
    warn("Could not reach server to check repo status.");
    return null;
  }
}
async function stepGitHubInstall(ctx) {
  const installationsUrl = `${ctx.serverUrl}/api/cli/github/installations`;
  logApi("GET", installationsUrl);
  const instRes = await fetch(installationsUrl, {
    headers: { Authorization: `Bearer ${ctx.apiKey}` }
  });
  logApi("GET", installationsUrl, instRes.status);
  if (instRes.ok) {
    const instData = await instRes.json();
    if (instData.installations.length > 0) {
      const accounts = instData.installations.map((i) => i.accountLogin).join(", ");
      logInfo("GitHub App already installed", { accounts });
      success(`GitHub App installed for ${pc.bold(accounts)}`);
      return true;
    }
  }
  section("GitHub connection...");
  info(`Your GitHub account ${pc.bold(ctx.git?.owner ?? "")} isn't connected.`);
  blank();
  const prompts = (await import("prompts")).default;
  const confirm = await prompts({
    type: "confirm",
    name: "install",
    message: "Install kap10 GitHub App to connect your repos?",
    initial: true
  });
  if (!confirm.install) {
    logInfo("User declined GitHub App install");
    info("Skipping GitHub connection. You can connect later from the dashboard.");
    return false;
  }
  const installUrl = `${ctx.serverUrl}/api/cli/github/install`;
  logApi("POST", installUrl);
  const installRes = await fetch(installUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json"
    }
  });
  logApi("POST", installUrl, installRes.status);
  if (!installRes.ok) {
    const body = await installRes.json().catch(() => ({}));
    logError("Failed to initiate GitHub install", body);
    fail(`Failed to start GitHub installation: ${body.error ?? installRes.statusText}`);
    return false;
  }
  const installData = await installRes.json();
  info("Opening browser to install kap10 GitHub App...");
  logInfo("Opening browser", { url: installData.installUrl });
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync2(`open "${installData.installUrl}"`, { stdio: "ignore" });
    } else if (platform === "linux") {
      execSync2(`xdg-open "${installData.installUrl}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync2(`start "" "${installData.installUrl}"`, { stdio: "ignore" });
    }
  } catch {
    info(`Open this URL in your browser:`);
    info(pc.underline(installData.installUrl));
  }
  const ora = (await import("ora")).default;
  const spinner = ora({ text: "Waiting for GitHub App installation...", indent: 4 }).start();
  logInfo("Polling for installation completion");
  const pollUrl = `${ctx.serverUrl}/api/cli/github/install/poll?token=${installData.pollToken}`;
  const deadline = Date.now() + 10 * 60 * 1e3;
  const pollInterval = 3e3;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    try {
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` }
      });
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        if (pollData.status === "complete") {
          spinner.stop();
          logInfo("GitHub App installed", { accountLogin: pollData.accountLogin });
          success(`GitHub App installed for ${pc.bold(pollData.accountLogin ?? "your account")}`);
          return true;
        }
        if (pollData.status === "error") {
          spinner.stop();
          logError("GitHub App installation failed", pollData);
          fail("GitHub App installation failed. Try again from the dashboard.");
          return false;
        }
      }
    } catch (error) {
      logError("Poll request failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  spinner.stop();
  logError("GitHub App installation timed out");
  fail("Installation timed out. You can complete it from the dashboard.");
  return false;
}
async function stepSelectAndAddRepos(ctx) {
  section("Repository setup...");
  const reposUrl = `${ctx.serverUrl}/api/cli/github/repos`;
  logApi("GET", reposUrl);
  const reposRes = await fetch(reposUrl, {
    headers: { Authorization: `Bearer ${ctx.apiKey}` }
  });
  logApi("GET", reposUrl, reposRes.status);
  if (!reposRes.ok) {
    const body = await reposRes.json().catch(() => ({}));
    logError("Failed to fetch available repos", body);
    fail(`Failed to list repos: ${body.error ?? reposRes.statusText}`);
    return null;
  }
  const reposData = await reposRes.json();
  if (reposData.repos.length === 0) {
    logInfo("No available repos found");
    info("No available repos found. Make sure the GitHub App has access to your repos.");
    return null;
  }
  const currentFullName = ctx.git?.fullName?.toLowerCase();
  const choices = reposData.repos.map((r) => ({
    title: `${r.fullName}${r.language ? ` ${pc.dim(`(${r.language}${r.private ? ", private" : ""})`)}` : r.private ? ` ${pc.dim("(private)")}` : ""}`,
    value: r.id,
    selected: r.fullName.toLowerCase() === currentFullName
  }));
  logInfo("Presenting repo selection", { count: choices.length });
  const prompts = (await import("prompts")).default;
  const response = await prompts({
    type: "multiselect",
    name: "repos",
    message: "Select repos to analyze:",
    choices,
    hint: "- Space to select. Enter to confirm.",
    instructions: false,
    min: 1
  });
  if (!response.repos || response.repos.length === 0) {
    logError("No repos selected");
    fail("No repos selected. Setup cancelled.");
    process.exit(1);
  }
  const selectedIds = response.repos;
  const selectedRepos = reposData.repos.filter((r) => selectedIds.includes(r.id));
  const selectedNames = selectedRepos.map((r) => r.fullName);
  logInfo("User selected repos", { repos: selectedNames });
  for (const name of selectedNames) {
    info(`Selected: ${pc.bold(name)}`);
  }
  const addUrl = `${ctx.serverUrl}/api/cli/repos`;
  const addBody = {
    repos: selectedRepos.map((r) => ({
      githubRepoId: r.id,
      branch: r.defaultBranch
    }))
  };
  logApi("POST", addUrl, void 0, addBody);
  const addRes = await fetch(addUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(addBody)
  });
  logApi("POST", addUrl, addRes.status);
  if (!addRes.ok) {
    const body = await addRes.json().catch(() => ({}));
    logError("Failed to add repos", body);
    fail(`Failed to add repos: ${body.error ?? addRes.statusText}`);
    return null;
  }
  const addData = await addRes.json();
  const currentRepo = addData.created.find((r) => r.fullName.toLowerCase() === currentFullName) ?? addData.alreadyExisting.find((r) => r.fullName.toLowerCase() === currentFullName) ?? addData.created[0] ?? addData.alreadyExisting[0];
  if (!currentRepo) {
    logError("No repo returned from add operation");
    fail("Failed to resolve repo. Try again from the dashboard.");
    return null;
  }
  if (addData.indexingStarted) {
    logInfo("Indexing started", { created: addData.created.length });
    success(`Added ${addData.created.length} repo(s) \u2014 indexing started`);
  } else if (addData.alreadyExisting.length > 0) {
    logInfo("Repos already existed", { existing: addData.alreadyExisting.length });
    success(`Repo(s) already on kap10`);
  }
  return { repoId: currentRepo.id, fullName: currentRepo.fullName };
}
async function stepLocalFlow(ctx) {
  section("Setting up local repo...");
  const cwd = process.cwd();
  const repoName = ctx.git?.repo ?? __require("path").basename(cwd);
  const initUrl = `${ctx.serverUrl}/api/cli/init`;
  const initBody = {
    name: repoName,
    fullName: ctx.git?.fullName ?? repoName,
    branch: ctx.git?.branch ?? "main"
  };
  logApi("POST", initUrl, void 0, initBody);
  const initRes = await fetch(initUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(initBody)
  });
  logApi("POST", initUrl, initRes.status);
  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    logError("Failed to register repo", body);
    fail(`Failed to register repo: ${body.error ?? initRes.statusText}`);
    return null;
  }
  const initData = await initRes.json();
  logInfo("Repo registered", initData);
  const kap10Dir = join3(cwd, ".kap10");
  mkdirSync2(kap10Dir, { recursive: true });
  writeFileSync(
    join3(kap10Dir, "config.json"),
    JSON.stringify({
      repoId: initData.repoId,
      serverUrl: ctx.serverUrl,
      orgId: initData.orgId,
      branch: ctx.git?.branch ?? "main"
    }, null, 2) + "\n"
  );
  const gitignorePath = join3(cwd, ".gitignore");
  if (existsSync2(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".kap10")) {
      appendFileSync2(gitignorePath, "\n# kap10 local config\n.kap10/\n");
    }
  } else {
    writeFileSync(gitignorePath, "# kap10 local config\n.kap10/\n");
  }
  success(`Registered: ${pc.bold(repoName)}`);
  info("Preparing upload...");
  logInfo("Starting upload phase");
  const indexUrl = `${ctx.serverUrl}/api/cli/index`;
  const uploadReqBody = { phase: "request_upload", repoId: initData.repoId };
  logApi("POST", indexUrl, void 0, uploadReqBody);
  const uploadRes = await fetch(indexUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(uploadReqBody)
  });
  logApi("POST", indexUrl, uploadRes.status);
  if (!uploadRes.ok) {
    const body = await uploadRes.json().catch(() => ({}));
    logError("Upload request failed", body);
    fail(`Upload request failed: ${body.error ?? uploadRes.statusText}`);
    return { repoId: initData.repoId };
  }
  const { uploadUrl, uploadPath } = await uploadRes.json();
  const archiver = (await import("archiver")).default;
  const ignore = (await import("ignore")).default;
  const path = await import("path");
  const fs = await import("fs");
  const gitignoreFilePath = path.join(cwd, ".gitignore");
  const ig = ignore();
  ig.add([".git", ".kap10", "node_modules"]);
  if (fs.existsSync(gitignoreFilePath)) {
    ig.add(fs.readFileSync(gitignoreFilePath, "utf-8"));
  }
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (chunk) => chunks.push(chunk));
  function walkDir(dir, relativeTo) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(relativeTo, fullPath);
      if (ig.ignores(relPath)) continue;
      if (entry.isDirectory()) {
        walkDir(fullPath, relativeTo);
      } else if (entry.isFile()) {
        archive.file(fullPath, { name: relPath });
      }
    }
  }
  walkDir(cwd, cwd);
  await archive.finalize();
  await new Promise((resolve) => archive.on("end", resolve));
  const zipBuffer = Buffer.concat(chunks);
  const sizeMb = (zipBuffer.length / 1024 / 1024).toFixed(1);
  info(`Uploading ${sizeMb}MB...`);
  logInfo("Uploading zip", { sizeBytes: zipBuffer.length });
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: zipBuffer
  });
  if (!putRes.ok) {
    logError("Upload failed", { status: putRes.status });
    fail(`Upload failed: ${putRes.statusText}`);
    return { repoId: initData.repoId };
  }
  const triggerBody = { phase: "trigger_index", repoId: initData.repoId, uploadPath };
  logApi("POST", indexUrl, void 0, triggerBody);
  const triggerRes = await fetch(indexUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(triggerBody)
  });
  logApi("POST", indexUrl, triggerRes.status);
  if (!triggerRes.ok) {
    const body = await triggerRes.json().catch(() => ({}));
    logError("Index trigger failed", body);
    fail(`Indexing failed: ${body.error ?? triggerRes.statusText}`);
    return { repoId: initData.repoId };
  }
  success("Upload complete \u2014 indexing started");
  return { repoId: initData.repoId };
}
async function stepPollIndexing(ctx, repoId) {
  section("Analyzing repository...");
  const ora = (await import("ora")).default;
  const spinner = ora({ text: "Indexing... this may take a few minutes", indent: 4 }).start();
  const statusUrl = `${ctx.serverUrl}/api/cli/repos/${repoId}/status`;
  const deadline = Date.now() + 15 * 60 * 1e3;
  let pollInterval = 5e3;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    try {
      const res = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ready") {
          spinner.stop();
          const stats = [
            data.fileCount ? `${data.fileCount} files` : null,
            data.functionCount ? `${data.functionCount} functions` : null,
            data.classCount ? `${data.classCount} classes` : null
          ].filter(Boolean).join(", ");
          logInfo("Indexing complete", data);
          success(`Analysis complete${stats ? ` \u2014 ${stats}` : ""}`);
          return;
        }
        if (data.status === "error") {
          spinner.stop();
          logError("Indexing failed", { error: data.errorMessage });
          fail(`Analysis failed: ${data.errorMessage ?? "Unknown error"}`);
          info("You can retry from the dashboard or run: kap10 push");
          return;
        }
        if (data.progress !== null) {
          spinner.text = `Indexing... ${data.progress}%`;
        }
      }
    } catch (error) {
      logError("Status poll failed", { error: error instanceof Error ? error.message : String(error) });
    }
    if (pollInterval < 1e4) {
      pollInterval = Math.min(pollInterval + 1500, 1e4);
    }
  }
  spinner.stop();
  logError("Indexing poll timed out after 15 minutes");
  info("Indexing is still running in the background.");
  info("MCP will be available once indexing completes.");
}
function stepConfigureMcp(ctx) {
  const cwd = process.cwd();
  section(`Configuring ${ideDisplayName(ctx.ide)}...`);
  if (ctx.ide === "cursor") {
    const configDir = join3(cwd, ".cursor");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join3(configDir, "mcp.json");
    let config = {};
    if (existsSync2(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        config = {};
      }
    }
    const mcpServers = config.mcpServers ?? {};
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    logInfo("MCP config written", { path: ".cursor/mcp.json" });
    success("Written: .cursor/mcp.json");
  } else if (ctx.ide === "vscode") {
    const configDir = join3(cwd, ".vscode");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join3(configDir, "settings.json");
    let settings = {};
    if (existsSync2(configPath)) {
      try {
        settings = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        settings = {};
      }
    }
    const mcpServers = settings["mcp.servers"] ?? {};
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    };
    settings["mcp.servers"] = mcpServers;
    writeFileSync(configPath, JSON.stringify(settings, null, 2));
    logInfo("MCP config written", { path: ".vscode/settings.json" });
    success("Written: .vscode/settings.json");
  } else if (ctx.ide === "windsurf") {
    const configDir = join3(cwd, ".windsurf");
    mkdirSync2(configDir, { recursive: true });
    const configPath = join3(configDir, "mcp.json");
    let config = {};
    if (existsSync2(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        config = {};
      }
    }
    const mcpServers = config.mcpServers ?? {};
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    logInfo("MCP config written", { path: ".windsurf/mcp.json" });
    success("Written: .windsurf/mcp.json");
  } else if (ctx.ide === "claude-code") {
    info("Run this command to configure Claude Code:");
    blank();
    console.log(`    ${pc.cyan("claude mcp add kap10 --transport http")} ${pc.dim(`"${ctx.serverUrl}/mcp"`)} \\`);
    console.log(`      ${pc.cyan("--header")} ${pc.dim(`"Authorization: Bearer ${ctx.apiKey}"`)}`);
    blank();
    logInfo("Claude Code MCP command printed");
    success("Claude Code command ready \u2014 paste it in your terminal");
  }
}
function stepInstallHooks() {
  try {
    const gitDir = execSync2("git rev-parse --git-dir", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const hooksDir = join3(gitDir, "hooks");
    mkdirSync2(hooksDir, { recursive: true });
    const hookScript = `#!/bin/sh
kap10 config verify --silent 2>/dev/null || true
`;
    let installed = 0;
    for (const hook of ["post-checkout", "post-merge"]) {
      const hookPath = join3(hooksDir, hook);
      if (!existsSync2(hookPath)) {
        writeFileSync(hookPath, hookScript, { mode: 493 });
        installed++;
      } else {
        const content = readFileSync(hookPath, "utf-8");
        if (!content.includes("kap10 config verify")) {
          appendFileSync2(hookPath, `
${hookScript}`);
          installed++;
        }
      }
    }
    if (installed > 0) {
      logInfo("Git hooks installed", { count: installed });
      success("Installed git hooks for config verification");
    }
  } catch {
    logInfo("Git hooks skipped (not a git repo or hooks not writable)");
  }
}
async function runSetup(opts) {
  const cwd = process.cwd();
  initLogFile(cwd);
  banner();
  const creds = await stepAuthenticate(opts?.server ?? DEFAULT_SERVER, opts?.key);
  blank();
  const ide = opts?.ide ?? await stepDetectIde(cwd);
  blank();
  const git = stepDetectGit();
  blank();
  const ctx = {
    serverUrl: creds.serverUrl,
    apiKey: creds.apiKey,
    orgId: creds.orgId,
    orgName: creds.orgName,
    ide,
    git
  };
  const existingRepo = await stepCheckRepo(ctx);
  blank();
  let repoId = existingRepo?.repoId ?? null;
  if (!existingRepo) {
    if (git?.host === "github") {
      const installed = await stepGitHubInstall(ctx);
      blank();
      if (installed) {
        const result = await stepSelectAndAddRepos(ctx);
        blank();
        if (result) {
          repoId = result.repoId;
        }
      }
    } else if (git) {
      const result = await stepLocalFlow(ctx);
      blank();
      if (result) {
        repoId = result.repoId;
      }
    } else {
      info("Run these commands to set up a local repo:");
      info(`  ${pc.cyan("kap10 init")} && ${pc.cyan("kap10 push")}`);
      blank();
    }
  }
  if (repoId && existingRepo?.status !== "ready" && existingRepo?.indexed !== true) {
    await stepPollIndexing(ctx, repoId);
    blank();
  }
  stepConfigureMcp(ctx);
  blank();
  if (isGitRepo()) {
    stepInstallHooks();
  }
  const logPath = getLogFilePath();
  done("Ready! Your AI agent now has access to your codebase graph.");
  if (logPath) {
    detail(`Logs: ${logPath}`);
  }
  blank();
}
export {
  runSetup
};
