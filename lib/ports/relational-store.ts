/**
 * Relational store port — Supabase/Prisma app data (users, orgs, repos, subscriptions, deletion_logs).
 * Phase 2: API keys, workspaces, repo onboarding fields.
 */

import type { PipelineStepRecord, PrReviewCommentRecord, PrReviewRecord, ReviewConfig } from "./types"

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
  // Context seeding
  contextDocuments?: string | null
  // Shadow reindexing
  currentIndexVersion?: string | null
  pendingIndexVersion?: string | null
  reindexStatus?: string | null
  // TBI-C-03: Workspace manifest metadata
  manifestData?: string | null
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

// Pipeline run record
export interface PipelineRunRecord {
  id: string
  repoId: string
  organizationId: string
  workflowId: string | null
  temporalRunId: string | null
  status: string
  triggerType: string
  triggerUserId: string | null
  pipelineType: string
  indexVersion: string | null
  startedAt: Date
  completedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
  steps: PipelineStepRecord[]
  fileCount: number | null
  functionCount: number | null
  classCount: number | null
  entitiesWritten: number | null
  edgesWritten: number | null
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
      lastIndexedAt?: Date | null
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

  // Context seeding
  updateRepoContextDocuments(repoId: string, contextDocuments: string | null): Promise<void>

  // Phase 5.6: Ephemeral sandbox
  promoteRepo(repoId: string): Promise<void>

  // Phase 2: Repo onboarding
  updateRepoOnboardingPr(repoId: string, prUrl: string, prNumber: number): Promise<void>

  // Pipeline run tracking
  createPipelineRun(data: {
    id: string
    repoId: string
    organizationId: string
    workflowId?: string
    triggerType: string
    triggerUserId?: string
    pipelineType?: string
    indexVersion?: string
    steps?: PipelineStepRecord[]
  }): Promise<PipelineRunRecord>
  getPipelineRun(runId: string): Promise<PipelineRunRecord | null>
  updatePipelineRun(
    runId: string,
    data: Partial<
      Pick<
        PipelineRunRecord,
        | "workflowId"
        | "temporalRunId"
        | "status"
        | "completedAt"
        | "durationMs"
        | "errorMessage"
        | "steps"
        | "fileCount"
        | "functionCount"
        | "classCount"
        | "entitiesWritten"
        | "edgesWritten"
      >
    >
  ): Promise<void>
  getPipelineRunsForRepo(
    orgId: string,
    repoId: string,
    opts?: { limit?: number; status?: string }
  ): Promise<PipelineRunRecord[]>
  getLatestPipelineRun(orgId: string, repoId: string): Promise<PipelineRunRecord | null>

  // Phase 7: PR Review Integration
  createPrReview(data: {
    repoId: string
    prNumber: number
    prTitle: string
    prUrl: string
    headSha: string
    baseSha: string
  }): Promise<PrReviewRecord>
  updatePrReview(id: string, data: Partial<Pick<PrReviewRecord, "status" | "checksPassed" | "checksWarned" | "checksFailed" | "reviewBody" | "githubReviewId" | "githubCheckRunId" | "autoApproved" | "errorMessage" | "completedAt">>): Promise<void>
  getPrReview(id: string): Promise<PrReviewRecord | null>
  getPrReviewByPrAndSha(repoId: string, prNumber: number, headSha: string): Promise<PrReviewRecord | null>
  listPrReviews(repoId: string, opts?: { status?: string; limit?: number; cursor?: string }): Promise<{ items: PrReviewRecord[]; cursor: string | null; hasMore: boolean }>
  createPrReviewComment(data: Omit<PrReviewCommentRecord, "id" | "createdAt">): Promise<PrReviewCommentRecord>
  listPrReviewComments(reviewId: string): Promise<PrReviewCommentRecord[]>
  updateRepoReviewConfig(repoId: string, config: ReviewConfig): Promise<void>
  getRepoReviewConfig(repoId: string): Promise<ReviewConfig>

  // TBI-C-03: Workspace manifest persistence
  updateRepoManifest(repoId: string, manifestData: string | null): Promise<void>
}
