/**
 * PrismaRelationalStore — IRelationalStore using Prisma (Supabase PostgreSQL).
 * Prisma 7 requires a driver adapter; we use @prisma/adapter-pg with SUPABASE_DB_URL.
 *
 * Workaround for Prisma 7 bug (prisma/prisma#28611): PrismaPg ignores @@schema()
 * directives and always queries `public`. We set search_path=unerr,public on the
 * connection so Prisma finds unerr tables first.
 */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import type {
  ApiKeyRecord,
  DeletionLogRecord,
  GitHubInstallationRecord,
  IRelationalStore,
  RepoRecord,
  WorkspaceRecord,
} from "@/lib/ports/relational-store"
import type { PrReviewCommentRecord, PrReviewRecord, ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"

let prismaInstance: PrismaClient | null = null

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    const connectionString =
      process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error(
        "PrismaClient requires SUPABASE_DB_URL or DATABASE_URL. Set it in .env.local."
      )
    }
    // Set search_path so Prisma resolves unerr-schema tables (repos, deletion_logs)
    // alongside public-schema tables (Better Auth). See: prisma/prisma#28611
    const searchPath = "unerr,public"
    const separator = connectionString.includes("?") ? "&" : "?"
    const connWithSchema =
      connectionString + separator + "options=-c%20search_path%3D" + encodeURIComponent(searchPath)
    const adapter = new PrismaPg({ connectionString: connWithSchema })
    prismaInstance = new PrismaClient({ adapter })
  }
  return prismaInstance
}

export class PrismaRelationalStore implements IRelationalStore {
  private prisma = getPrisma()

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    const start = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: "up", latencyMs: Date.now() - start }
    } catch {
      return { status: "down", latencyMs: Date.now() - start }
    }
  }

  private mapRepo(r: {
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
    githubRepoId: bigint | null
    githubFullName: string | null
    lastIndexedSha: string | null
    indexProgress: number
    fileCount: number
    functionCount: number
    classCount: number
    errorMessage: string | null
    workflowId: string | null
    onboardingPrUrl?: string | null
    onboardingPrNumber?: number | null
  }): RepoRecord {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      fullName: r.fullName,
      provider: r.provider,
      providerId: r.providerId,
      status: r.status,
      defaultBranch: r.defaultBranch,
      lastIndexedAt: r.lastIndexedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      githubRepoId: r.githubRepoId != null ? Number(r.githubRepoId) : null,
      githubFullName: r.githubFullName ?? undefined,
      lastIndexedSha: r.lastIndexedSha ?? undefined,
      indexProgress: r.indexProgress,
      fileCount: r.fileCount,
      functionCount: r.functionCount,
      classCount: r.classCount,
      errorMessage: r.errorMessage ?? undefined,
      workflowId: r.workflowId ?? undefined,
      onboardingPrUrl: r.onboardingPrUrl ?? undefined,
      onboardingPrNumber: r.onboardingPrNumber ?? undefined,
    }
  }

  async getRepos(orgId: string): Promise<RepoRecord[]> {
    const rows = await this.prisma.repo.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return rows.map((r) => this.mapRepo(r))
  }

  async getRepo(orgId: string, repoId: string): Promise<RepoRecord | null> {
    const row = await this.prisma.repo.findFirst({
      where: { id: repoId, organizationId: orgId },
    })
    return row ? this.mapRepo(row) : null
  }

  async createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
    githubRepoId?: number
    githubFullName?: string
  }): Promise<RepoRecord> {
    const row = await this.prisma.repo.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        fullName: data.fullName,
        provider: data.provider as "github",
        providerId: data.providerId,
        status: (data.status as "pending" | "indexing" | "ready" | "error" | "deleting") ?? "pending",
        defaultBranch: data.defaultBranch ?? "main",
        githubRepoId: data.githubRepoId != null ? BigInt(data.githubRepoId) : undefined,
        githubFullName: data.githubFullName,
      },
    })
    return this.mapRepo(row)
  }

  async getInstallation(orgId: string): Promise<GitHubInstallationRecord | null> {
    const row = await this.prisma.gitHubInstallation.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
    })
    if (!row) return null
    return this.mapInstallation(row)
  }

  async getInstallations(orgId: string): Promise<GitHubInstallationRecord[]> {
    const rows = await this.prisma.gitHubInstallation.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
    })
    return rows.map((r) => this.mapInstallation(r))
  }

  async getInstallationByInstallationId(installationId: number): Promise<GitHubInstallationRecord | null> {
    const row = await this.prisma.gitHubInstallation.findFirst({
      where: { installationId: BigInt(installationId) },
    })
    if (!row) return null
    return this.mapInstallation(row)
  }

  private mapInstallation(row: {
    id: string
    organizationId: string
    installationId: bigint
    accountLogin: string
    accountType: string
    permissions: unknown
    suspendedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }): GitHubInstallationRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      installationId: Number(row.installationId),
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      permissions: row.permissions,
      suspendedAt: row.suspendedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async createInstallation(data: {
    organizationId: string
    installationId: number
    accountLogin: string
    accountType: string
    permissions?: unknown
  }): Promise<GitHubInstallationRecord> {
    const row = await this.prisma.gitHubInstallation.create({
      data: {
        organizationId: data.organizationId,
        installationId: BigInt(data.installationId),
        accountLogin: data.accountLogin,
        accountType: data.accountType,
        permissions: data.permissions ?? undefined,
      },
    })
    return this.mapInstallation(row)
  }

  async deleteInstallation(orgId: string): Promise<void> {
    await this.prisma.gitHubInstallation.deleteMany({
      where: { organizationId: orgId },
    })
  }

  async deleteInstallationById(installationRecordId: string): Promise<void> {
    await this.prisma.gitHubInstallation.delete({
      where: { id: installationRecordId },
    })
  }

  async updateRepoStatus(
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
  ): Promise<void> {
    await this.prisma.repo.update({
      where: { id: repoId },
      data: {
        ...(data.status && { status: data.status as "pending" | "indexing" | "ready" | "error" | "deleting" }),
        ...(data.progress !== undefined && { indexProgress: data.progress }),
        ...(data.workflowId !== undefined && { workflowId: data.workflowId }),
        ...(data.fileCount !== undefined && { fileCount: data.fileCount }),
        ...(data.functionCount !== undefined && { functionCount: data.functionCount }),
        ...(data.classCount !== undefined && { classCount: data.classCount }),
        ...(data.errorMessage !== undefined && { errorMessage: data.errorMessage }),
        ...(data.lastIndexedSha !== undefined && { lastIndexedSha: data.lastIndexedSha }),
      },
    })
  }

  async getRepoByGithubId(orgId: string, githubRepoId: number): Promise<RepoRecord | null> {
    const row = await this.prisma.repo.findFirst({
      where: { organizationId: orgId, githubRepoId: BigInt(githubRepoId) },
    })
    return row ? this.mapRepo(row) : null
  }

  async getReposByStatus(orgId: string, status: string): Promise<RepoRecord[]> {
    const rows = await this.prisma.repo.findMany({
      where: { organizationId: orgId, status: status as "pending" | "indexing" | "ready" | "error" | "deleting" },
    })
    return rows.map((r) => this.mapRepo(r))
  }

  async deleteRepo(repoId: string): Promise<void> {
    await this.prisma.repo.delete({ where: { id: repoId } })
  }

  async promoteRepo(repoId: string): Promise<void> {
    await this.prisma.repo.update({
      where: { id: repoId },
      data: {
        ephemeral: false,
        ephemeralExpiresAt: null,
      },
    })
  }

  async getDeletionLogs(orgId: string, limit = 50): Promise<DeletionLogRecord[]> {
    const rows = await this.prisma.deletionLog.findMany({
      where: { organizationId: orgId },
      orderBy: { requestedAt: "desc" },
      take: limit,
    })
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      repoId: r.repoId,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      entitiesDeleted: r.entitiesDeleted,
      embeddingsDeleted: r.embeddingsDeleted,
      status: r.status,
      errorMessage: r.errorMessage,
    }))
  }

  // ── Phase 2: API key management ───────────────────────────────

  async createApiKey(data: {
    organizationId: string
    repoId?: string | null
    name: string
    keyPrefix: string
    keyHash: string
    scopes: string[]
    isDefault?: boolean
  }): Promise<ApiKeyRecord> {
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId: data.organizationId,
        repoId: data.repoId ?? null,
        name: data.name,
        keyPrefix: data.keyPrefix,
        keyHash: data.keyHash,
        scopes: data.scopes,
        isDefault: data.isDefault ?? false,
      },
    })
    return {
      id: row.id,
      organizationId: row.organizationId,
      repoId: row.repoId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      scopes: row.scopes,
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = await this.prisma.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
    })
    if (!row) return null
    return {
      id: row.id,
      organizationId: row.organizationId,
      repoId: row.repoId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      scopes: row.scopes,
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async getDefaultApiKey(orgId: string): Promise<ApiKeyRecord | null> {
    const row = await this.prisma.apiKey.findFirst({
      where: { organizationId: orgId, isDefault: true, revokedAt: null },
    })
    if (!row) return null
    return {
      id: row.id,
      organizationId: row.organizationId,
      repoId: row.repoId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      scopes: row.scopes,
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    })
  }

  async listApiKeys(orgId: string, repoId?: string): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: {
        organizationId: orgId,
        ...(repoId && { repoId }),
      },
      orderBy: { createdAt: "desc" },
    })
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      repoId: row.repoId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      scopes: row.scopes,
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })
  }

  // ── Phase 2: Workspace management ─────────────────────────────

  async createWorkspace(data: {
    userId: string
    repoId: string
    branch: string
    baseSha?: string
    expiresAt: Date
  }): Promise<WorkspaceRecord> {
    const row = await this.prisma.workspace.upsert({
      where: {
        userId_repoId_branch: {
          userId: data.userId,
          repoId: data.repoId,
          branch: data.branch,
        },
      },
      create: {
        userId: data.userId,
        repoId: data.repoId,
        branch: data.branch,
        baseSha: data.baseSha,
        expiresAt: data.expiresAt,
        lastSyncAt: new Date(),
      },
      update: {
        baseSha: data.baseSha,
        expiresAt: data.expiresAt,
        lastSyncAt: new Date(),
      },
    })
    return {
      id: row.id,
      userId: row.userId,
      repoId: row.repoId,
      branch: row.branch,
      baseSha: row.baseSha,
      lastSyncAt: row.lastSyncAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }

  async getWorkspace(userId: string, repoId: string, branch: string): Promise<WorkspaceRecord | null> {
    const row = await this.prisma.workspace.findUnique({
      where: {
        userId_repoId_branch: { userId, repoId, branch },
      },
    })
    if (!row) return null
    return {
      id: row.id,
      userId: row.userId,
      repoId: row.repoId,
      branch: row.branch,
      baseSha: row.baseSha,
      lastSyncAt: row.lastSyncAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }

  async updateWorkspaceSync(id: string, baseSha?: string): Promise<void> {
    const ttlHours = parseInt(process.env.MCP_WORKSPACE_TTL_HOURS ?? "12", 10)
    await this.prisma.workspace.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
        ...(baseSha && { baseSha }),
      },
    })
  }

  async deleteExpiredWorkspaces(): Promise<WorkspaceRecord[]> {
    const expired = await this.prisma.workspace.findMany({
      where: { expiresAt: { lt: new Date() } },
    })
    if (expired.length > 0) {
      await this.prisma.workspace.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
    }
    return expired.map((row) => ({
      id: row.id,
      userId: row.userId,
      repoId: row.repoId,
      branch: row.branch,
      baseSha: row.baseSha,
      lastSyncAt: row.lastSyncAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }))
  }

  // ── Phase 2: Repo onboarding ──────────────────────────────────

  async updateRepoOnboardingPr(repoId: string, prUrl: string, prNumber: number): Promise<void> {
    await this.prisma.repo.update({
      where: { id: repoId },
      data: {
        onboardingPrUrl: prUrl,
        onboardingPrNumber: prNumber,
      },
    })
  }

  // ── Phase 7: PR Review Integration ──────────────────────────────

  async createPrReview(data: {
    repoId: string
    prNumber: number
    prTitle: string
    prUrl: string
    headSha: string
    baseSha: string
  }): Promise<PrReviewRecord> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.prisma.$executeRaw`
      INSERT INTO unerr.pr_reviews (id, repo_id, pr_number, pr_title, pr_url, head_sha, base_sha, status, checks_passed, checks_warned, checks_failed, auto_approved, created_at)
      VALUES (${id}, ${data.repoId}, ${data.prNumber}, ${data.prTitle}, ${data.prUrl}, ${data.headSha}, ${data.baseSha}, 'pending', 0, 0, 0, false, ${now})
    `
    return {
      id,
      repoId: data.repoId,
      prNumber: data.prNumber,
      prTitle: data.prTitle,
      prUrl: data.prUrl,
      headSha: data.headSha,
      baseSha: data.baseSha,
      status: "pending",
      checksPassed: 0,
      checksWarned: 0,
      checksFailed: 0,
      reviewBody: null,
      githubReviewId: null,
      githubCheckRunId: null,
      autoApproved: false,
      errorMessage: null,
      completedAt: null,
      createdAt: now,
    }
  }

  async updatePrReview(
    id: string,
    data: Partial<Pick<PrReviewRecord, "status" | "checksPassed" | "checksWarned" | "checksFailed" | "reviewBody" | "githubReviewId" | "githubCheckRunId" | "autoApproved" | "errorMessage" | "completedAt">>
  ): Promise<void> {
    const sets: string[] = []
    const values: unknown[] = []
    if (data.status !== undefined) { sets.push("status"); values.push(data.status) }
    if (data.checksPassed !== undefined) { sets.push("checks_passed"); values.push(data.checksPassed) }
    if (data.checksWarned !== undefined) { sets.push("checks_warned"); values.push(data.checksWarned) }
    if (data.checksFailed !== undefined) { sets.push("checks_failed"); values.push(data.checksFailed) }
    if (data.reviewBody !== undefined) { sets.push("review_body"); values.push(data.reviewBody) }
    if (data.githubReviewId !== undefined) { sets.push("github_review_id"); values.push(data.githubReviewId) }
    if (data.githubCheckRunId !== undefined) { sets.push("github_check_run_id"); values.push(data.githubCheckRunId) }
    if (data.autoApproved !== undefined) { sets.push("auto_approved"); values.push(data.autoApproved) }
    if (data.errorMessage !== undefined) { sets.push("error_message"); values.push(data.errorMessage) }
    if (data.completedAt !== undefined) { sets.push("completed_at"); values.push(data.completedAt) }
    if (sets.length === 0) return
    const setClause = sets.map((col, i) => `${col} = $${i + 2}`).join(", ")
    await this.prisma.$executeRawUnsafe(
      `UPDATE unerr.pr_reviews SET ${setClause} WHERE id = $1`,
      id,
      ...values
    )
  }

  async getPrReview(id: string): Promise<PrReviewRecord | null> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM unerr.pr_reviews WHERE id = ${id} LIMIT 1
    `
    if (rows.length === 0) return null
    return this.mapPrReviewRow(rows[0]!)
  }

  async getPrReviewByPrAndSha(repoId: string, prNumber: number, headSha: string): Promise<PrReviewRecord | null> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM unerr.pr_reviews WHERE repo_id = ${repoId} AND pr_number = ${prNumber} AND head_sha = ${headSha} LIMIT 1
    `
    if (rows.length === 0) return null
    return this.mapPrReviewRow(rows[0]!)
  }

  async listPrReviews(
    repoId: string,
    opts?: { status?: string; limit?: number; cursor?: string }
  ): Promise<{ items: PrReviewRecord[]; cursor: string | null; hasMore: boolean }> {
    const limit = opts?.limit ?? 20
    const conditions = ["repo_id = $1"]
    const params: unknown[] = [repoId]
    let paramIdx = 2
    if (opts?.status) {
      conditions.push(`status = $${paramIdx}`)
      params.push(opts.status)
      paramIdx++
    }
    if (opts?.cursor) {
      conditions.push(`created_at < $${paramIdx}`)
      params.push(opts.cursor)
      paramIdx++
    }
    const where = conditions.join(" AND ")
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM unerr.pr_reviews WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
      ...params,
      limit + 1
    )
    const hasMore = rows.length > limit
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => this.mapPrReviewRow(r))
    const lastItem = items[items.length - 1]
    return {
      items,
      cursor: hasMore && lastItem ? lastItem.createdAt : null,
      hasMore,
    }
  }

  async createPrReviewComment(
    data: Omit<PrReviewCommentRecord, "id" | "createdAt">
  ): Promise<PrReviewCommentRecord> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.prisma.$executeRaw`
      INSERT INTO unerr.pr_review_comments (id, review_id, check_type, severity, file_path, line_number, message, rule_title, semgrep_rule_id, suggestion, auto_fix, created_at)
      VALUES (${id}, ${data.reviewId}, ${data.checkType}, ${data.severity}, ${data.filePath ?? null}, ${data.lineNumber ?? null}, ${data.message}, ${data.ruleTitle ?? null}, ${data.semgrepRuleId ?? null}, ${data.suggestion ?? null}, ${data.autoFix ?? null}, ${now})
    `
    return { ...data, id, createdAt: now }
  }

  async listPrReviewComments(reviewId: string): Promise<PrReviewCommentRecord[]> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM unerr.pr_review_comments WHERE review_id = ${reviewId} ORDER BY created_at ASC LIMIT 500
    `
    return rows.map((r) => ({
      id: String(r.id),
      reviewId: String(r.review_id),
      checkType: String(r.check_type) as PrReviewCommentRecord["checkType"],
      severity: String(r.severity) as PrReviewCommentRecord["severity"],
      filePath: String(r.file_path ?? ""),
      lineNumber: Number(r.line_number ?? 0),
      message: String(r.message),
      ruleTitle: r.rule_title ? String(r.rule_title) : null,
      semgrepRuleId: r.semgrep_rule_id ? String(r.semgrep_rule_id) : null,
      suggestion: r.suggestion ? String(r.suggestion) : null,
      githubCommentId: r.github_comment_id != null ? Number(r.github_comment_id) : null,
      autoFix: r.auto_fix ? String(r.auto_fix) : null,
      createdAt: String(r.created_at),
    }))
  }

  async updateRepoReviewConfig(repoId: string, config: ReviewConfig): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE unerr.repos SET review_config = ${JSON.stringify(config)}::jsonb WHERE id = ${repoId}
    `
  }

  async getRepoReviewConfig(repoId: string): Promise<ReviewConfig> {
    const rows = await this.prisma.$queryRaw<Array<{ review_config: unknown }>>`
      SELECT review_config FROM unerr.repos WHERE id = ${repoId} LIMIT 1
    `
    if (rows.length === 0 || !rows[0]!.review_config) return { ...DEFAULT_REVIEW_CONFIG }
    return { ...DEFAULT_REVIEW_CONFIG, ...(rows[0]!.review_config as ReviewConfig) }
  }

  private mapPrReviewRow(r: Record<string, unknown>): PrReviewRecord {
    return {
      id: String(r.id),
      repoId: String(r.repo_id),
      prNumber: Number(r.pr_number),
      prTitle: String(r.pr_title),
      prUrl: String(r.pr_url),
      headSha: String(r.head_sha),
      baseSha: String(r.base_sha),
      status: String(r.status) as PrReviewRecord["status"],
      checksPassed: Number(r.checks_passed ?? 0),
      checksWarned: Number(r.checks_warned ?? 0),
      checksFailed: Number(r.checks_failed ?? 0),
      reviewBody: r.review_body ? String(r.review_body) : null,
      githubReviewId: r.github_review_id != null ? Number(r.github_review_id) : null,
      githubCheckRunId: r.github_check_run_id != null ? Number(r.github_check_run_id) : null,
      autoApproved: Boolean(r.auto_approved),
      errorMessage: r.error_message ? String(r.error_message) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
    }
  }
}

export default PrismaRelationalStore
