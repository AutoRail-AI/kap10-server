/**
 * Smart detection utilities for git host and IDE type.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

export type GitHost = "github" | "gitlab" | "bitbucket" | "other"

export type IdeType = "cursor" | "claude-code" | "vscode" | "windsurf" | "unknown"

export interface GitContext {
  remote: string
  branch: string
  owner: string
  repo: string
  fullName: string
  host: GitHost
}

/**
 * Classify a git remote URL into a known host or "other".
 */
export function classifyHost(remote: string): GitHost {
  const lower = remote.toLowerCase()
  if (lower.includes("github.com")) return "github"
  if (lower.includes("gitlab.com") || lower.includes("gitlab.")) return "gitlab"
  if (lower.includes("bitbucket.org") || lower.includes("bitbucket.")) return "bitbucket"
  return "other"
}

/**
 * Parse a remote URL into owner/repo format.
 */
function parseRemote(remote: string): string | null {
  // git@github.com:owner/repo.git
  const sshMatch = remote.match(/git@[^:]+:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1] ?? null
  // https://github.com/owner/repo.git
  const httpMatch = remote.match(/(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+?)(?:\.git)?$/)
  if (httpMatch) return httpMatch[1] ?? null
  return null
}

/**
 * Detect full git context from the current working directory.
 */
export function detectGitContext(): GitContext | null {
  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const branch = execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

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
      host: classifyHost(remote),
    }
  } catch {
    return null
  }
}

/**
 * Check if the current directory is inside a git repository.
 */
export function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Auto-detect the IDE from project directory and environment.
 *
 * Checks in order:
 *  1. CURSOR_TRACE_ID env → Cursor terminal
 *  2. TERM_PROGRAM=vscode + cursor extensions path → Cursor
 *  3. CLAUDE_CODE env or "claude" process ancestry → Claude Code
 *  4. .cursor/ directory in project → Cursor
 *  5. .windsurf/ directory in project → Windsurf
 *  6. TERM_PROGRAM=vscode → VS Code
 *  7. .vscode/ directory in project → VS Code
 *  8. "unknown" → will be prompted
 */
export function detectIde(cwd: string): IdeType {
  // Cursor sets CURSOR_TRACE_ID in its integrated terminal
  if (process.env.CURSOR_TRACE_ID) return "cursor"

  // Claude Code sets CLAUDE_CODE or similar markers
  if (process.env.CLAUDE_CODE === "1" || process.env.CLAUDE_CODE === "true") return "claude-code"

  // Check TERM_PROGRAM for VS Code-based editors
  const termProgram = process.env.TERM_PROGRAM ?? ""
  if (termProgram === "vscode") {
    // Could be Cursor (fork of VS Code) — check for Cursor-specific paths
    const cursorExtensions = process.env.VSCODE_CWD ?? ""
    if (cursorExtensions.toLowerCase().includes("cursor")) return "cursor"
  }

  // Check for Claude Code in process ancestry
  try {
    const ppidChain = execSync("ps -o comm= -p $PPID 2>/dev/null || true", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    if (ppidChain.includes("claude")) return "claude-code"
  } catch {
    // Ignore — process inspection may not be available
  }

  // Directory-based detection
  if (existsSync(join(cwd, ".cursor"))) return "cursor"
  if (existsSync(join(cwd, ".windsurf"))) return "windsurf"
  if (termProgram === "vscode") return "vscode"
  if (existsSync(join(cwd, ".vscode"))) return "vscode"

  return "unknown"
}

/**
 * Human-readable IDE name for display.
 */
export function ideDisplayName(ide: IdeType): string {
  switch (ide) {
    case "cursor": return "Cursor"
    case "claude-code": return "Claude Code"
    case "vscode": return "VS Code"
    case "windsurf": return "Windsurf"
    case "unknown": return "your IDE"
  }
}

/**
 * All IDE choices for interactive prompt.
 */
export const IDE_CHOICES: Array<{ title: string; value: IdeType }> = [
  { title: "Cursor", value: "cursor" },
  { title: "Claude Code", value: "claude-code" },
  { title: "VS Code", value: "vscode" },
  { title: "Windsurf", value: "windsurf" },
]
