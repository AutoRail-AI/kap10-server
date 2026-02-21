/**
 * Relational store port — Supabase/Prisma app data (users, orgs, repos, subscriptions, deletion_logs).
 * Phase 2: API keys, workspaces, repo onboarding fields.
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
  // Phase 2
  onboardingPrUrl?: string | null
  onboardingPrNumber?: number | null
  // Phase 5.5/5.6
  localCliUploadPath?: string | null
  ephemeral?: boolean
  ephemeralExpiresAt?: Date | null
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

// Phase 2: API key record (org-level when repoId is null)
export interface ApiKeyRecord {
  id: string
  organizationId: string
  repoId: string | null
  name: string
  keyPrefix: string
  keyHash: string
  scopes: string[]
  isDefault: boolean
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// Phase 2: Workspace record
export interface WorkspaceRecord {
  id: string
  userId: string
  repoId: string
  branch: string
  baseSha: string | null
  lastSyncAt: Date | null
  expiresAt: Date
  createdAt: Date
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

  // Phase 2: API key management
  createApiKey(data: {
    organizationId: string
    repoId?: string | null
    name: string
    keyPrefix: string
    keyHash: string
    scopes: string[]
    isDefault?: boolean
  }): Promise<ApiKeyRecord>
  getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>
  getDefaultApiKey(orgId: string): Promise<ApiKeyRecord | null>
  revokeApiKey(id: string): Promise<void>
  listApiKeys(orgId: string, repoId?: string): Promise<ApiKeyRecord[]>
  updateApiKeyLastUsed(id: string): Promise<void>

  // Phase 2: Workspace management
  createWorkspace(data: {
    userId: string
    repoId: string
    branch: string
    baseSha?: string
    expiresAt: Date
  }): Promise<WorkspaceRecord>
  getWorkspace(userId: string, repoId: string, branch: string): Promise<WorkspaceRecord | null>
  updateWorkspaceSync(id: string, baseSha?: string): Promise<void>
  deleteExpiredWorkspaces(): Promise<WorkspaceRecord[]>

  // Phase 2: Repo onboarding
  updateRepoOnboardingPr(repoId: string, prUrl: string, prNumber: number): Promise<void>
}
