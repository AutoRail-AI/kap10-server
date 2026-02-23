/**
 * kap10 setup — The magic default command.
 *
 * Runs when the user types `npx @autorail/kap10` with no subcommand.
 * Orchestrates the full onboarding flow:
 *
 *  1. Authenticate (device flow or API key)
 *  2. Detect IDE (auto-detect or interactive prompt)
 *  3. Detect git context (host, owner, repo, branch)
 *  4. Check if repo exists on kap10
 *  5. GitHub flow: install app → select repos → trigger indexing
 *     Local flow: init → push → trigger indexing
 *  6. Poll indexing progress
 *  7. Configure MCP for the detected IDE
 *  8. Install git hooks
 *  9. Done
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { getCredentials, saveCredentials, deviceAuthFlow } from "./auth.js"
import {
  detectGitContext,
  detectIde,
  ideDisplayName,
  isGitRepo,
  IDE_CHOICES,
  type IdeType,
  type GitContext,
} from "../utils/detect.js"
import { banner, section, success, fail, info, detail, warn, blank, done, pc } from "../utils/ui.js"
import { initLogFile, logInfo, logError, logApi, getLogFilePath } from "../utils/log.js"

const DEFAULT_SERVER = "https://app.kap10.dev"

interface SetupContext {
  serverUrl: string
  apiKey: string
  orgId?: string
  orgName?: string
  ide: IdeType
  git: GitContext | null
}

// ─── Step 1: Authentication ───────────────────────────────────────────────────

async function stepAuthenticate(serverUrl: string, apiKey?: string): Promise<{
  serverUrl: string
  apiKey: string
  orgId?: string
  orgName?: string
}> {
  section("Authenticating...")

  const existing = getCredentials()
  if (existing && !apiKey) {
    logInfo("Using existing credentials", { serverUrl: existing.serverUrl, orgName: existing.orgName })
    success(`Authenticated as ${pc.bold(existing.orgName ?? existing.serverUrl)}`)
    return {
      serverUrl: existing.serverUrl,
      apiKey: existing.apiKey,
      orgId: existing.orgId,
      orgName: existing.orgName,
    }
  }

  if (apiKey) {
    const creds = { serverUrl, apiKey }
    saveCredentials(creds)
    logInfo("API key saved")
    success("API key saved")
    return creds
  }

  info("Opening browser for login...")
  logInfo("Starting device auth flow", { serverUrl })

  try {
    const creds = await deviceAuthFlow(serverUrl)
    saveCredentials(creds)
    logInfo("Device auth complete", { orgName: creds.orgName })
    success(`Authenticated as ${pc.bold(creds.orgName ?? "your organization")}`)
    return creds
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logError("Authentication failed", { error: message })
    fail(`Authentication failed: ${message}`)
    process.exit(1)
  }
}

// ─── Step 2: IDE Detection ────────────────────────────────────────────────────

async function stepDetectIde(cwd: string): Promise<IdeType> {
  section("Detecting coding agent...")

  const detected = detectIde(cwd)
  if (detected !== "unknown") {
    logInfo("IDE auto-detected", { ide: detected })
    success(`Detected ${pc.bold(ideDisplayName(detected))}`)
    return detected
  }

  logInfo("IDE not auto-detected, prompting user")
  info("Could not auto-detect your coding agent.")
  blank()

  const prompts = (await import("prompts")).default
  const response = await prompts({
    type: "select",
    name: "ide",
    message: "Which coding agent are you using?",
    choices: IDE_CHOICES.map((c) => ({ title: c.title, value: c.value })),
  })

  if (!response.ide) {
    logError("IDE selection cancelled")
    fail("Setup cancelled")
    process.exit(1)
  }

  const ide = response.ide as IdeType
  logInfo("IDE selected by user", { ide })
  success(`Selected ${pc.bold(ideDisplayName(ide))}`)
  return ide
}

// ─── Step 3: Git Detection ────────────────────────────────────────────────────

function stepDetectGit(): GitContext | null {
  section("Detecting repository...")

  if (!isGitRepo()) {
    logInfo("Not a git repository")
    warn("Not inside a git repository.")
    info("You can still use kap10 with local upload (kap10 init + kap10 push).")
    return null
  }

  const git = detectGitContext()
  if (!git) {
    logInfo("Git repo found but no remote origin")
    warn("Git repository found but no remote origin configured.")
    return null
  }

  const hostLabel =
    git.host === "github" ? "GitHub" :
    git.host === "gitlab" ? "GitLab" :
    git.host === "bitbucket" ? "Bitbucket" :
    "Git"

  logInfo("Git context detected", { host: git.host, fullName: git.fullName, branch: git.branch })
  success(`${hostLabel} repo: ${pc.bold(git.fullName)} ${pc.dim(`(${git.branch})`)}`)
  return git
}

// ─── Step 4: Check Repo on kap10 ─────────────────────────────────────────────

async function stepCheckRepo(
  ctx: SetupContext
): Promise<{ repoId: string; status: string; indexed: boolean } | null> {
  section("Checking kap10...")

  if (!ctx.git) return null

  try {
    const url = `${ctx.serverUrl}/api/cli/context?remote=${encodeURIComponent(ctx.git.remote)}`
    logApi("GET", url)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    })
    logApi("GET", url, res.status)

    if (res.ok) {
      const data = (await res.json()) as {
        repoId: string
        repoName: string
        status: string
        indexed: boolean
      }
      logInfo("Repo found on kap10", data)

      if (data.indexed) {
        success(`Already indexed: ${pc.bold(data.repoName)}`)
      } else {
        info(`Found: ${data.repoName} (${data.status})`)
        if (data.status === "indexing") {
          info("Repo is still indexing. MCP will work once indexing completes.")
        }
      }
      return { repoId: data.repoId, status: data.status, indexed: data.indexed }
    }

    if (res.status === 404) {
      logInfo("Repo not found on kap10")
      info("This repo isn't on kap10 yet.")
      return null
    }

    logError("Unexpected status checking repo", { status: res.status })
    warn(`Could not check repo status (${res.status})`)
    return null
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logError("Failed to check repo", { error: message })
    warn("Could not reach server to check repo status.")
    return null
  }
}

// ─── Step 5a: GitHub Flow ─────────────────────────────────────────────────────

async function stepGitHubInstall(ctx: SetupContext): Promise<boolean> {
  // Check if GitHub App is already installed
  const installationsUrl = `${ctx.serverUrl}/api/cli/github/installations`
  logApi("GET", installationsUrl)
  const instRes = await fetch(installationsUrl, {
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
  })
  logApi("GET", installationsUrl, instRes.status)

  if (instRes.ok) {
    const instData = (await instRes.json()) as {
      installations: Array<{ accountLogin: string }>
    }
    if (instData.installations.length > 0) {
      const accounts = instData.installations.map((i) => i.accountLogin).join(", ")
      logInfo("GitHub App already installed", { accounts })
      success(`GitHub App installed for ${pc.bold(accounts)}`)
      return true
    }
  }

  // Need to install GitHub App
  section("GitHub connection...")
  info(`Your GitHub account ${pc.bold(ctx.git?.owner ?? "")} isn't connected.`)
  blank()

  const prompts = (await import("prompts")).default
  const confirm = await prompts({
    type: "confirm",
    name: "install",
    message: "Install kap10 GitHub App to connect your repos?",
    initial: true,
  })

  if (!confirm.install) {
    logInfo("User declined GitHub App install")
    info("Skipping GitHub connection. You can connect later from the dashboard.")
    return false
  }

  // Initiate install
  const installUrl = `${ctx.serverUrl}/api/cli/github/install`
  logApi("POST", installUrl)
  const installRes = await fetch(installUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
  })
  logApi("POST", installUrl, installRes.status)

  if (!installRes.ok) {
    const body = (await installRes.json().catch(() => ({}))) as { error?: string }
    logError("Failed to initiate GitHub install", body)
    fail(`Failed to start GitHub installation: ${body.error ?? installRes.statusText}`)
    return false
  }

  const installData = (await installRes.json()) as { installUrl: string; pollToken: string }

  // Open browser
  info("Opening browser to install kap10 GitHub App...")
  logInfo("Opening browser", { url: installData.installUrl })

  try {
    const platform = process.platform
    if (platform === "darwin") {
      execSync(`open "${installData.installUrl}"`, { stdio: "ignore" })
    } else if (platform === "linux") {
      execSync(`xdg-open "${installData.installUrl}"`, { stdio: "ignore" })
    } else if (platform === "win32") {
      execSync(`start "" "${installData.installUrl}"`, { stdio: "ignore" })
    }
  } catch {
    info(`Open this URL in your browser:`)
    info(pc.underline(installData.installUrl))
  }

  // Poll for completion
  const ora = (await import("ora")).default
  const spinner = ora({ text: "Waiting for GitHub App installation...", indent: 4 }).start()
  logInfo("Polling for installation completion")

  const pollUrl = `${ctx.serverUrl}/api/cli/github/install/poll?token=${installData.pollToken}`
  const deadline = Date.now() + 10 * 60 * 1000 // 10 minute timeout
  const pollInterval = 3000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval))

    try {
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
      })

      if (pollRes.ok) {
        const pollData = (await pollRes.json()) as {
          status: string
          accountLogin?: string
        }

        if (pollData.status === "complete") {
          spinner.stop()
          logInfo("GitHub App installed", { accountLogin: pollData.accountLogin })
          success(`GitHub App installed for ${pc.bold(pollData.accountLogin ?? "your account")}`)
          return true
        }

        if (pollData.status === "error") {
          spinner.stop()
          logError("GitHub App installation failed", pollData)
          fail("GitHub App installation failed. Try again from the dashboard.")
          return false
        }
      }
    } catch (error: unknown) {
      logError("Poll request failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  spinner.stop()
  logError("GitHub App installation timed out")
  fail("Installation timed out. You can complete it from the dashboard.")
  return false
}

async function stepSelectAndAddRepos(
  ctx: SetupContext
): Promise<{ repoId: string; fullName: string } | null> {
  section("Repository setup...")

  const reposUrl = `${ctx.serverUrl}/api/cli/github/repos`
  logApi("GET", reposUrl)
  const reposRes = await fetch(reposUrl, {
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
  })
  logApi("GET", reposUrl, reposRes.status)

  if (!reposRes.ok) {
    const body = (await reposRes.json().catch(() => ({}))) as { error?: string }
    logError("Failed to fetch available repos", body)
    fail(`Failed to list repos: ${body.error ?? reposRes.statusText}`)
    return null
  }

  const reposData = (await reposRes.json()) as {
    repos: Array<{
      id: number
      fullName: string
      defaultBranch: string
      language: string | null
      private: boolean
    }>
  }

  if (reposData.repos.length === 0) {
    logInfo("No available repos found")
    info("No available repos found. Make sure the GitHub App has access to your repos.")
    return null
  }

  // Pre-select the current repo if it matches
  const currentFullName = ctx.git?.fullName?.toLowerCase()
  const choices = reposData.repos.map((r) => ({
    title: `${r.fullName}${r.language ? ` ${pc.dim(`(${r.language}${r.private ? ", private" : ""})`)}` : r.private ? ` ${pc.dim("(private)")}` : ""}`,
    value: r.id,
    selected: r.fullName.toLowerCase() === currentFullName,
  }))

  logInfo("Presenting repo selection", { count: choices.length })
  const prompts = (await import("prompts")).default

  const response = await prompts({
    type: "multiselect",
    name: "repos",
    message: "Select repos to analyze:",
    choices,
    hint: "- Space to select. Enter to confirm.",
    instructions: false,
    min: 1,
  })

  if (!response.repos || response.repos.length === 0) {
    logError("No repos selected")
    fail("No repos selected. Setup cancelled.")
    process.exit(1)
  }

  const selectedIds = response.repos as number[]
  const selectedRepos = reposData.repos.filter((r) => selectedIds.includes(r.id))
  const selectedNames = selectedRepos.map((r) => r.fullName)
  logInfo("User selected repos", { repos: selectedNames })

  for (const name of selectedNames) {
    info(`Selected: ${pc.bold(name)}`)
  }

  // Add repos and trigger indexing
  const addUrl = `${ctx.serverUrl}/api/cli/repos`
  const addBody = {
    repos: selectedRepos.map((r) => ({
      githubRepoId: r.id,
      branch: r.defaultBranch,
    })),
  }
  logApi("POST", addUrl, undefined, addBody)

  const addRes = await fetch(addUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(addBody),
  })
  logApi("POST", addUrl, addRes.status)

  if (!addRes.ok) {
    const body = (await addRes.json().catch(() => ({}))) as { error?: string }
    logError("Failed to add repos", body)
    fail(`Failed to add repos: ${body.error ?? addRes.statusText}`)
    return null
  }

  const addData = (await addRes.json()) as {
    created: Array<{ id: string; fullName: string; status: string }>
    alreadyExisting: Array<{ id: string; fullName: string; status: string }>
    indexingStarted: boolean
  }

  // Find the current repo from results
  const currentRepo =
    addData.created.find((r) => r.fullName.toLowerCase() === currentFullName) ??
    addData.alreadyExisting.find((r) => r.fullName.toLowerCase() === currentFullName) ??
    addData.created[0] ??
    addData.alreadyExisting[0]

  if (!currentRepo) {
    logError("No repo returned from add operation")
    fail("Failed to resolve repo. Try again from the dashboard.")
    return null
  }

  if (addData.indexingStarted) {
    logInfo("Indexing started", { created: addData.created.length })
    success(`Added ${addData.created.length} repo(s) — indexing started`)
  } else if (addData.alreadyExisting.length > 0) {
    logInfo("Repos already existed", { existing: addData.alreadyExisting.length })
    success(`Repo(s) already on kap10`)
  }

  return { repoId: currentRepo.id, fullName: currentRepo.fullName }
}

// ─── Step 5b: Local Flow ──────────────────────────────────────────────────────

async function stepLocalFlow(ctx: SetupContext): Promise<{ repoId: string } | null> {
  section("Setting up local repo...")

  const cwd = process.cwd()
  const repoName = ctx.git?.repo ?? require("node:path").basename(cwd)

  // Register via /api/cli/init
  const initUrl = `${ctx.serverUrl}/api/cli/init`
  const initBody = {
    name: repoName,
    fullName: ctx.git?.fullName ?? repoName,
    branch: ctx.git?.branch ?? "main",
  }
  logApi("POST", initUrl, undefined, initBody)

  const initRes = await fetch(initUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(initBody),
  })
  logApi("POST", initUrl, initRes.status)

  if (!initRes.ok) {
    const body = (await initRes.json().catch(() => ({}))) as { error?: string }
    logError("Failed to register repo", body)
    fail(`Failed to register repo: ${body.error ?? initRes.statusText}`)
    return null
  }

  const initData = (await initRes.json()) as { repoId: string; orgId: string }
  logInfo("Repo registered", initData)

  // Write .kap10/config.json
  const kap10Dir = join(cwd, ".kap10")
  mkdirSync(kap10Dir, { recursive: true })
  writeFileSync(
    join(kap10Dir, "config.json"),
    JSON.stringify({
      repoId: initData.repoId,
      serverUrl: ctx.serverUrl,
      orgId: initData.orgId,
      branch: ctx.git?.branch ?? "main",
    }, null, 2) + "\n"
  )

  // Add .kap10 to .gitignore
  const gitignorePath = join(cwd, ".gitignore")
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8")
    if (!content.includes(".kap10")) {
      appendFileSync(gitignorePath, "\n# kap10 local config\n.kap10/\n")
    }
  } else {
    writeFileSync(gitignorePath, "# kap10 local config\n.kap10/\n")
  }

  success(`Registered: ${pc.bold(repoName)}`)

  // Upload and index
  info("Preparing upload...")
  logInfo("Starting upload phase")

  const indexUrl = `${ctx.serverUrl}/api/cli/index`

  // Phase 1: Request upload URL
  const uploadReqBody = { phase: "request_upload", repoId: initData.repoId }
  logApi("POST", indexUrl, undefined, uploadReqBody)
  const uploadRes = await fetch(indexUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(uploadReqBody),
  })
  logApi("POST", indexUrl, uploadRes.status)

  if (!uploadRes.ok) {
    const body = (await uploadRes.json().catch(() => ({}))) as { error?: string }
    logError("Upload request failed", body)
    fail(`Upload request failed: ${body.error ?? uploadRes.statusText}`)
    return { repoId: initData.repoId }
  }

  const { uploadUrl, uploadPath } = (await uploadRes.json()) as {
    uploadUrl: string
    uploadPath: string
  }

  // Create .gitignore-aware zip
  const archiver = (await import("archiver")).default
  const ignore = (await import("ignore")).default
  const path = await import("node:path")
  const fs = await import("node:fs")

  const gitignoreFilePath = path.join(cwd, ".gitignore")
  const ig = ignore()
  ig.add([".git", ".kap10", "node_modules"])
  if (fs.existsSync(gitignoreFilePath)) {
    ig.add(fs.readFileSync(gitignoreFilePath, "utf-8"))
  }

  const archive = archiver("zip", { zlib: { level: 6 } })
  const chunks: Buffer[] = []
  archive.on("data", (chunk: Buffer) => chunks.push(chunk))

  function walkDir(dir: string, relativeTo: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(relativeTo, fullPath)
      if (ig.ignores(relPath)) continue
      if (entry.isDirectory()) {
        walkDir(fullPath, relativeTo)
      } else if (entry.isFile()) {
        archive.file(fullPath, { name: relPath })
      }
    }
  }

  walkDir(cwd, cwd)
  await archive.finalize()
  await new Promise<void>((resolve) => archive.on("end", resolve))
  const zipBuffer = Buffer.concat(chunks)

  const sizeMb = (zipBuffer.length / 1024 / 1024).toFixed(1)
  info(`Uploading ${sizeMb}MB...`)
  logInfo("Uploading zip", { sizeBytes: zipBuffer.length })

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: zipBuffer,
  })

  if (!putRes.ok) {
    logError("Upload failed", { status: putRes.status })
    fail(`Upload failed: ${putRes.statusText}`)
    return { repoId: initData.repoId }
  }

  // Phase 2: Trigger indexing
  const triggerBody = { phase: "trigger_index", repoId: initData.repoId, uploadPath }
  logApi("POST", indexUrl, undefined, triggerBody)
  const triggerRes = await fetch(indexUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(triggerBody),
  })
  logApi("POST", indexUrl, triggerRes.status)

  if (!triggerRes.ok) {
    const body = (await triggerRes.json().catch(() => ({}))) as { error?: string }
    logError("Index trigger failed", body)
    fail(`Indexing failed: ${body.error ?? triggerRes.statusText}`)
    return { repoId: initData.repoId }
  }

  success("Upload complete — indexing started")
  return { repoId: initData.repoId }
}

// ─── Step 6: Poll Indexing ────────────────────────────────────────────────────

async function stepPollIndexing(ctx: SetupContext, repoId: string): Promise<void> {
  section("Analyzing repository...")

  const ora = (await import("ora")).default
  const spinner = ora({ text: "Indexing... this may take a few minutes", indent: 4 }).start()

  const statusUrl = `${ctx.serverUrl}/api/cli/repos/${repoId}/status`
  const deadline = Date.now() + 15 * 60 * 1000 // 15 minute timeout
  let pollInterval = 5000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval))

    try {
      const res = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
      })

      if (res.ok) {
        const data = (await res.json()) as {
          status: string
          progress: number | null
          fileCount: number | null
          functionCount: number | null
          classCount: number | null
          errorMessage: string | null
        }

        if (data.status === "ready") {
          spinner.stop()
          const stats = [
            data.fileCount ? `${data.fileCount} files` : null,
            data.functionCount ? `${data.functionCount} functions` : null,
            data.classCount ? `${data.classCount} classes` : null,
          ].filter(Boolean).join(", ")
          logInfo("Indexing complete", data)
          success(`Analysis complete${stats ? ` — ${stats}` : ""}`)
          return
        }

        if (data.status === "error") {
          spinner.stop()
          logError("Indexing failed", { error: data.errorMessage })
          fail(`Analysis failed: ${data.errorMessage ?? "Unknown error"}`)
          info("You can retry from the dashboard or run: kap10 push")
          return
        }

        if (data.progress !== null) {
          spinner.text = `Indexing... ${data.progress}%`
        }
      }
    } catch (error: unknown) {
      logError("Status poll failed", { error: error instanceof Error ? error.message : String(error) })
    }

    // Exponential backoff: 5s → 8s → 10s (cap)
    if (pollInterval < 10000) {
      pollInterval = Math.min(pollInterval + 1500, 10000)
    }
  }

  spinner.stop()
  logError("Indexing poll timed out after 15 minutes")
  info("Indexing is still running in the background.")
  info("MCP will be available once indexing completes.")
}

// ─── Step 7: MCP Config ──────────────────────────────────────────────────────

function stepConfigureMcp(ctx: SetupContext): void {
  const cwd = process.cwd()
  section(`Configuring ${ideDisplayName(ctx.ide)}...`)

  if (ctx.ide === "cursor") {
    const configDir = join(cwd, ".cursor")
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "mcp.json")

    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
      } catch {
        config = {}
      }
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    }
    config.mcpServers = mcpServers
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    logInfo("MCP config written", { path: ".cursor/mcp.json" })
    success("Written: .cursor/mcp.json")
  } else if (ctx.ide === "vscode") {
    const configDir = join(cwd, ".vscode")
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "settings.json")

    let settings: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        settings = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
      } catch {
        settings = {}
      }
    }

    const mcpServers = (settings["mcp.servers"] ?? {}) as Record<string, unknown>
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    }
    settings["mcp.servers"] = mcpServers
    writeFileSync(configPath, JSON.stringify(settings, null, 2))
    logInfo("MCP config written", { path: ".vscode/settings.json" })
    success("Written: .vscode/settings.json")
  } else if (ctx.ide === "windsurf") {
    const configDir = join(cwd, ".windsurf")
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "mcp.json")

    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
      } catch {
        config = {}
      }
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
    mcpServers["kap10"] = {
      url: `${ctx.serverUrl}/mcp`,
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    }
    config.mcpServers = mcpServers
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    logInfo("MCP config written", { path: ".windsurf/mcp.json" })
    success("Written: .windsurf/mcp.json")
  } else if (ctx.ide === "claude-code") {
    info("Run this command to configure Claude Code:")
    blank()
    console.log(`    ${pc.cyan("claude mcp add kap10 --transport http")} ${pc.dim(`"${ctx.serverUrl}/mcp"`)} \\`)
    console.log(`      ${pc.cyan("--header")} ${pc.dim(`"Authorization: Bearer ${ctx.apiKey}"`)}`)
    blank()
    logInfo("Claude Code MCP command printed")
    success("Claude Code command ready — paste it in your terminal")
  }
}

// ─── Step 8: Git Hooks ───────────────────────────────────────────────────────

function stepInstallHooks(): void {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    const hooksDir = join(gitDir, "hooks")
    mkdirSync(hooksDir, { recursive: true })

    const hookScript = `#!/bin/sh\nkap10 config verify --silent 2>/dev/null || true\n`
    let installed = 0

    for (const hook of ["post-checkout", "post-merge"]) {
      const hookPath = join(hooksDir, hook)
      if (!existsSync(hookPath)) {
        writeFileSync(hookPath, hookScript, { mode: 0o755 })
        installed++
      } else {
        const content = readFileSync(hookPath, "utf-8")
        if (!content.includes("kap10 config verify")) {
          appendFileSync(hookPath, `\n${hookScript}`)
          installed++
        }
      }
    }

    if (installed > 0) {
      logInfo("Git hooks installed", { count: installed })
      success("Installed git hooks for config verification")
    }
  } catch {
    logInfo("Git hooks skipped (not a git repo or hooks not writable)")
  }
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

export async function runSetup(opts?: {
  server?: string
  key?: string
  ide?: string
}): Promise<void> {
  const cwd = process.cwd()
  initLogFile(cwd)

  banner()

  // Step 1: Authenticate
  const creds = await stepAuthenticate(opts?.server ?? DEFAULT_SERVER, opts?.key)
  blank()

  // Step 2: Detect IDE
  const ide = (opts?.ide as IdeType) ?? await stepDetectIde(cwd)
  blank()

  // Step 3: Detect git
  const git = stepDetectGit()
  blank()

  const ctx: SetupContext = {
    serverUrl: creds.serverUrl,
    apiKey: creds.apiKey,
    orgId: creds.orgId,
    orgName: creds.orgName,
    ide,
    git,
  }

  // Step 4: Check if repo already on kap10
  const existingRepo = await stepCheckRepo(ctx)
  blank()

  let repoId: string | null = existingRepo?.repoId ?? null

  if (!existingRepo) {
    if (git?.host === "github") {
      // Step 5a: GitHub flow
      const installed = await stepGitHubInstall(ctx)
      blank()

      if (installed) {
        const result = await stepSelectAndAddRepos(ctx)
        blank()

        if (result) {
          repoId = result.repoId
        }
      }
    } else if (git) {
      // Step 5b: Non-GitHub git repo → local flow
      const result = await stepLocalFlow(ctx)
      blank()

      if (result) {
        repoId = result.repoId
      }
    } else {
      // No git at all → suggest init
      info("Run these commands to set up a local repo:")
      info(`  ${pc.cyan("kap10 init")} && ${pc.cyan("kap10 push")}`)
      blank()
    }
  }

  // Step 6: Poll indexing (if we have a repo that's not yet ready)
  if (repoId && existingRepo?.status !== "ready" && existingRepo?.indexed !== true) {
    await stepPollIndexing(ctx, repoId)
    blank()
  }

  // Step 7: Configure MCP
  stepConfigureMcp(ctx)
  blank()

  // Step 8: Git hooks
  if (isGitRepo()) {
    stepInstallHooks()
  }

  // Done
  const logPath = getLogFilePath()
  done("Ready! Your AI agent now has access to your codebase graph.")
  if (logPath) {
    detail(`Logs: ${logPath}`)
  }
  blank()
}
