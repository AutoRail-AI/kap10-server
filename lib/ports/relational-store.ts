/**
 * Relational store port — Supabase/Prisma app data (users, orgs, repos, subscriptions, deletion_logs).
 */

export interface RepoRecord {
  id: string
  organizationId: string
  name: string
  fullName: string
  provider: string
  providerId: string
  status: string
  defaultBranch: string
  lastIndexedAt: Date | null
  createdAt: Date
  updatedAt: Date
  // Phase 1
  githubRepoId?: number | null
  githubFullName?: string | null
  lastIndexedSha?: string | null
  indexProgress?: number
  fileCount?: number
  functionCount?: number
  classCount?: number
  errorMessage?: string | null
  workflowId?: string | null
}

export interface GitHubInstallationRecord {
  id: string
  organizationId: string
  installationId: number
  accountLogin: string
  accountType: string
  permissions: unknown
  suspendedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface DeletionLogRecord {
  id: string
  organizationId: string
  repoId: string | null
  requestedAt: Date
  completedAt: Date | null
  entitiesDeleted: number
  embeddingsDeleted: number
  status: string
  errorMessage: string | null
}

export interface IRelationalStore {
  /** Health: can we reach the database? */
  healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }>
  getRepos(orgId: string): Promise<RepoRecord[]>
  getRepo(orgId: string, repoId: string): Promise<RepoRecord | null>
  createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
    githubRepoId?: number
    githubFullName?: string
  }): Promise<RepoRecord>
  getDeletionLogs(orgId: string, limit?: number): Promise<DeletionLogRecord[]>
  // Phase 1: GitHub App installations (multiple per org)
  getInstallation(orgId: string): Promise<GitHubInstallationRecord | null>
  getInstallations(orgId: string): Promise<GitHubInstallationRecord[]>
  getInstallationByInstallationId(installationId: number): Promise<GitHubInstallationRecord | null>
  createInstallation(data: {
    organizationId: string
    installationId: number
    accountLogin: string
    accountType: string
    permissions?: unknown
  }): Promise<GitHubInstallationRecord>
  deleteInstallation(orgId: string): Promise<void>
  deleteInstallationById(installationRecordId: string): Promise<void>
  // Phase 1: Repo indexing status
  updateRepoStatus(
    repoId: string,
    data: {
      status: string
      progress?: number
      workflowId?: string | null
      fileCount?: number
      functionCount?: number
      classCount?: number
      errorMessage?: string | null
      lastIndexedSha?: string | null
    }
  ): Promise<void>
  getRepoByGithubId(orgId: string, githubRepoId: number): Promise<RepoRecord | null>
  getReposByStatus(orgId: string, status: string): Promise<RepoRecord[]>
  deleteRepo(repoId: string): Promise<void>
}
