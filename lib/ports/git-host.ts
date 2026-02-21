export interface CloneOptions {
  ref?: string
  [key: string]: unknown
}

export interface PullRequest {
  number: number
  title: string
  [key: string]: unknown
}

export interface CreatePRParams {
  title: string
  body: string
  head: string
  base: string
  [key: string]: unknown
}

export interface FileEntry {
  path: string
  type?: "file" | "dir"
  size?: number
  [key: string]: unknown
}

/** Repo accessible to a GitHub App installation (from GET /installation/repositories) */
export interface GitHubRepo {
  id: number
  fullName: string
  defaultBranch: string
  language: string | null
  private: boolean
}

export interface IGitHost {
  cloneRepo(url: string, destination: string, options?: CloneOptions): Promise<void>
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>
  createPullRequest(owner: string, repo: string, params: CreatePRParams): Promise<PullRequest>
  getDiff(owner: string, repo: string, base: string, head: string): Promise<string>
  listFiles(owner: string, repo: string, ref?: string, installationId?: number): Promise<FileEntry[]>
  createWebhook(owner: string, repo: string, events: string[], url: string): Promise<void>
  /** Phase 1: List repos accessible to this GitHub App installation */
  getInstallationRepos(installationId: number): Promise<GitHubRepo[]>
  /** Phase 1: Get installation-scoped token (1hr TTL, not stored) */
  getInstallationToken(installationId: number): Promise<string>
  /** List branch names for a repository via installation token */
  listBranches(owner: string, repo: string, installationId: number): Promise<string[]>

  // Phase 5: Incremental indexing
  /** Pull latest changes for an existing clone */
  pullLatest(workspacePath: string, branch: string): Promise<void>
  /** Get list of changed files between two SHAs */
  diffFiles(workspacePath: string, fromSha: string, toSha: string): Promise<import("./types").ChangedFile[]>
  /** Get the latest SHA for a branch via GitHub API */
  getLatestSha(owner: string, repo: string, branch: string, installationId: number): Promise<string>
  /** Git blame a specific line of a file */
  blame(workspacePath: string, filePath: string, line: number): Promise<string | null>
}
