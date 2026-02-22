/**
 * GitHubHost — IGitHost implementation using GitHub App (Octokit) and simple-git.
 * Phase 1: cloneRepo, listFiles, getInstallationRepos, getInstallationToken; createWebhook no-op for App-level.
 */

import { getInstallationOctokit, getInstallationToken as getToken } from "@/lib/github/client"
import type { FileEntry, GitHubRepo, IGitHost } from "@/lib/ports/git-host"
import type { ChangedFile } from "@/lib/ports/types"
import { NotImplementedError } from "./errors"

function getSimpleGit(): typeof import("simple-git").default {
  const sg = require("simple-git") as typeof import("simple-git")
  return sg.default ?? sg
}

export class GitHubHost implements IGitHost {
  async cloneRepo(url: string, destination: string, options?: { ref?: string; installationId?: number }): Promise<void> {
    const installationId = options?.installationId
    let cloneUrl = url
    if (installationId != null) {
      const token = await getToken(installationId)
      cloneUrl = url.replace(/^https:\/\//, `https://x-access-token:${token}@`)
    }
    const fs = require("node:fs") as typeof import("node:fs")
    const path = require("node:path") as typeof import("node:path")
    const parent = path.dirname(destination)
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
    const simpleGit = getSimpleGit()
    const git = simpleGit()
    if (fs.existsSync(destination)) {
      const repoGit = git.cwd(destination)
      // Update remote URL with a fresh token (the original token has expired)
      await repoGit.remote(["set-url", "origin", cloneUrl])
      await repoGit.pull()
      if (options?.ref) await repoGit.checkout(options.ref)
      return
    }
    await git.clone(cloneUrl, destination)
    if (options?.ref) {
      const g = simpleGit(destination)
      await g.checkout(options.ref)
    }
  }

  async getPullRequest(): Promise<never> {
    throw new NotImplementedError("IGitHost.getPullRequest not implemented in Phase 1")
  }

  async createPullRequest(): Promise<never> {
    throw new NotImplementedError("IGitHost.createPullRequest not implemented in Phase 1")
  }

  async getDiff(): Promise<string> {
    throw new NotImplementedError("IGitHost.getDiff not implemented in Phase 1")
  }

  async listFiles(owner: string, repo: string, ref?: string, installationId?: number): Promise<FileEntry[]> {
    if (installationId == null) {
      return []
    }
    const octokit = getInstallationOctokit(installationId)
    const defaultRef = ref ?? "HEAD"
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "",
      ref: defaultRef,
    })
    if (Array.isArray(data)) {
      return data.map((f) => ({
        path: f.path ?? "",
        type: f.type === "dir" ? "dir" : "file",
        size: "size" in f ? (f.size as number) : undefined,
      }))
    }
    return []
  }

  async createWebhook(): Promise<void> {
    // GitHub App webhooks are configured at App level; per-repo webhooks not needed for Phase 1
    return
  }

  async getInstallationRepos(installationId: number): Promise<GitHubRepo[]> {
    const octokit = getInstallationOctokit(installationId)
    const repos: GitHubRepo[] = []
    let page = 1
    const perPage = 100
    while (true) {
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: perPage, page })
      const list = "repositories" in data ? data.repositories : []
      for (const r of list) {
        repos.push({
          id: r.id,
          fullName: r.full_name ?? `${r.owner?.login}/${r.name}`,
          defaultBranch: (r.default_branch as string) ?? "main",
          language: r.language ?? null,
          private: r.private ?? false,
        })
      }
      if (list.length < perPage) break
      page++
    }
    return repos
  }

  async getInstallationToken(installationId: number): Promise<string> {
    return getToken(installationId)
  }

  async listBranches(owner: string, repo: string, installationId: number): Promise<string[]> {
    const octokit = getInstallationOctokit(installationId)
    const branches: string[] = []
    let page = 1
    const perPage = 100
    while (true) {
      const { data } = await octokit.rest.repos.listBranches({ owner, repo, per_page: perPage, page })
      for (const b of data) {
        branches.push(b.name)
      }
      if (data.length < perPage) break
      page++
    }
    return branches
  }

  // ── Phase 5: Incremental Indexing ──────────────────────────────

  async pullLatest(workspacePath: string, branch: string): Promise<void> {
    const simpleGit = getSimpleGit()
    const git = simpleGit(workspacePath)
    await git.fetch("origin", branch)
    await git.checkout(branch)
    await git.pull("origin", branch)
  }

  async diffFiles(workspacePath: string, fromSha: string, toSha: string): Promise<ChangedFile[]> {
    const { execFile } = require("node:child_process") as typeof import("node:child_process")
    const { promisify } = require("node:util") as typeof import("node:util")
    const execFileAsync = promisify(execFile)

    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-status", fromSha, toSha],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 }
    )

    const changes: ChangedFile[] = []
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const status = parts[0]
      const filePath = parts[1]
      if (!status || !filePath) continue

      let changeType: ChangedFile["changeType"]
      if (status.startsWith("A")) changeType = "added"
      else if (status.startsWith("D")) changeType = "removed"
      else changeType = "modified" // M, R, C, T, etc.

      // For renames (R###), the new path is parts[2]
      const path = status.startsWith("R") && parts[2] ? parts[2] : filePath
      changes.push({ path, changeType })

      // Also track the old path of renames as "removed"
      if (status.startsWith("R") && parts[2]) {
        changes.push({ path: filePath, changeType: "removed" })
      }
    }
    return changes
  }

  async getLatestSha(owner: string, repo: string, branch: string, installationId: number): Promise<string> {
    const octokit = getInstallationOctokit(installationId)
    const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch })
    return data.commit.sha
  }

  async blame(workspacePath: string, filePath: string, line: number): Promise<string | null> {
    const { execFile } = require("node:child_process") as typeof import("node:child_process")
    const { promisify } = require("node:util") as typeof import("node:util")
    const execFileAsync = promisify(execFile)

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["blame", "-L", `${line},${line}`, "--porcelain", filePath],
        { cwd: workspacePath }
      )
      // Parse porcelain blame for author
      const authorMatch = stdout.match(/^author (.+)$/m)
      return authorMatch?.[1] ?? null
    } catch {
      return null
    }
  }

  // ── Phase 7: PR Review Integration ──────────────────────────────

  async postReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: {
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
      body: string
      comments?: Array<{ path: string; line: number; body: string }>
    }
  ): Promise<{ reviewId: number }> {
    // Resolve installation for this owner/repo
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    const { data } = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: review.event,
      body: review.body,
      comments: review.comments?.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    })
    return { reviewId: data.id }
  }

  async postReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    comment: { path: string; line: number; body: string; commitId: string }
  ): Promise<{ commentId: number }> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    const { data } = await octokit.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      path: comment.path,
      line: comment.line,
      body: comment.body,
      commit_id: comment.commitId,
    })
    return { commentId: data.id }
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    const files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }> = []
    let page = 1
    const perPage = 100
    while (true) {
      const { data } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      })
      for (const f of data) {
        files.push({
          filename: f.filename,
          status: f.status ?? "modified",
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          patch: f.patch,
        })
      }
      if (data.length < perPage) break
      page++
    }
    return files
  }

  async createCheckRun(
    owner: string,
    repo: string,
    opts: { name: string; headSha: string; status: "in_progress" }
  ): Promise<{ checkRunId: number }> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    const { data } = await octokit.rest.checks.create({
      owner,
      repo,
      name: opts.name,
      head_sha: opts.headSha,
      status: opts.status,
    })
    return { checkRunId: data.id }
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    opts: {
      status: "completed"
      conclusion: "success" | "failure" | "neutral"
      output: {
        title: string
        summary: string
        annotations: Array<{
          path: string; start_line: number; end_line: number
          annotation_level: "notice" | "warning" | "failure"
          message: string; title: string; raw_details: string
        }>
      }
    }
  ): Promise<void> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    // GitHub Checks API limits annotations to 50 per request
    const allAnnotations = opts.output.annotations
    const firstBatch = allAnnotations.slice(0, 50)
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: opts.status,
      conclusion: opts.conclusion,
      output: {
        title: opts.output.title,
        summary: opts.output.summary,
        annotations: firstBatch,
      },
    })
    // Send remaining annotations in batches of 50
    for (let i = 50; i < allAnnotations.length; i += 50) {
      const batch = allAnnotations.slice(i, i + 50)
      await octokit.rest.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        output: {
          title: opts.output.title,
          summary: opts.output.summary,
          annotations: batch,
        },
      })
    }
  }

  async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<{ commentId: number }> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    })
    return { commentId: data.id }
  }

  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromSha: string
  ): Promise<void> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    })
  }

  async createOrUpdateFile(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    content: string,
    opts: { message: string }
  ): Promise<{ sha: string }> {
    const inst = await this.resolveInstallation(owner, repo)
    const octokit = getInstallationOctokit(inst)
    // Check if file already exists to get its SHA
    let existingSha: string | undefined
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
      if (!Array.isArray(data) && "sha" in data) {
        existingSha = data.sha
      }
    } catch {
      // File doesn't exist — creating new
    }
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: opts.message,
      content: Buffer.from(content).toString("base64"),
      branch,
      sha: existingSha,
    })
    return { sha: data.content?.sha ?? "" }
  }

  /** Resolve the installation ID for an owner/repo pair */
  private async resolveInstallation(owner: string, _repo: string): Promise<number> {
    // Look up installation from relational store by owner login
    // This is called from within activities where the container is available
    // For now, use the GitHub App API to get installation for the account
    const { getAppOctokit } = require("@/lib/github/client") as typeof import("@/lib/github/client")
    const appOctokit = getAppOctokit()
    const { data } = await appOctokit.rest.apps.getUserInstallation({ username: owner }).catch(() =>
      appOctokit.rest.apps.getOrgInstallation({ org: owner })
    )
    return data.id
  }
}
