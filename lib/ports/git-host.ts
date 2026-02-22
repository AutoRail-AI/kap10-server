export interface CloneOptions {
  ref?: string
  [key: string]: unknown
}

export interface PullRequest {
  number: number
  title: string
  headSha?: string
  baseSha?: string
  htmlUrl?: string
  body?: string
  draft?: boolean
  merged?: boolean
  state?: "open" | "closed"
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

  // Phase 7: PR Review Integration
  /** Post a pull request review with inline comments */
  postReview(owner: string, repo: string, prNumber: number, review: {
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
    body: string
    comments?: Array<{ path: string; line: number; body: string }>
  }): Promise<{ reviewId: number }>
  /** Post a single review comment on a PR */
  postReviewComment(owner: string, repo: string, prNumber: number, comment: {
    path: string; line: number; body: string; commitId: string
  }): Promise<{ commentId: number }>
  /** Get files changed in a PR (paginated) */
  getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<Array<{
    filename: string; status: string; additions: number; deletions: number; patch?: string
  }>>
  /** Create a GitHub Check Run */
  createCheckRun(owner: string, repo: string, opts: {
    name: string; headSha: string; status: "in_progress"
  }): Promise<{ checkRunId: number }>
  /** Update a GitHub Check Run */
  updateCheckRun(owner: string, repo: string, checkRunId: number, opts: {
    status: "completed"
    conclusion: "success" | "failure" | "neutral"
    output: { title: string; summary: string; annotations: Array<{
      path: string; start_line: number; end_line: number
      annotation_level: "notice" | "warning" | "failure"
      message: string; title: string; raw_details: string
    }> }
  }): Promise<void>
  /** Post an issue/PR comment (not a review comment) */
  postIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ commentId: number }>
  /** Create a new branch from a SHA */
  createBranch(owner: string, repo: string, branchName: string, fromSha: string): Promise<void>
  /** Create or update a file in a branch */
  createOrUpdateFile(owner: string, repo: string, branch: string, path: string, content: string, opts: { message: string }): Promise<{ sha: string }>
}
