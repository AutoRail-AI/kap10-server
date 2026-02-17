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
  [key: string]: unknown
}

export interface IGitHost {
  cloneRepo(url: string, destination: string, options?: CloneOptions): Promise<void>
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>
  createPullRequest(owner: string, repo: string, params: CreatePRParams): Promise<PullRequest>
  getDiff(owner: string, repo: string, base: string, head: string): Promise<string>
  listFiles(owner: string, repo: string, ref?: string): Promise<FileEntry[]>
  createWebhook(owner: string, repo: string, events: string[], url: string): Promise<void>
}
