/**
 * GitHubHost — IGitHost implementation using GitHub App (Octokit) and simple-git.
 * Phase 1: cloneRepo, listFiles, getInstallationRepos, getInstallationToken; createWebhook no-op for App-level.
 */

import { getInstallationOctokit, getInstallationToken as getToken } from "@/lib/github/client"
import type { FileEntry, GitHubRepo, IGitHost } from "@/lib/ports/git-host"
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
}
