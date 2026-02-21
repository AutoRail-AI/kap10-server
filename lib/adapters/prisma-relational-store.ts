/**
 * PrismaRelationalStore — IRelationalStore using Prisma (Supabase PostgreSQL).
 * Prisma 7 requires a driver adapter; we use @prisma/adapter-pg with SUPABASE_DB_URL.
 *
 * Workaround for Prisma 7 bug (prisma/prisma#28611): PrismaPg ignores @@schema()
 * directives and always queries `public`. We set search_path=kap10,public on the
 * connection so Prisma finds kap10 tables first.
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
    // Set search_path so Prisma resolves kap10-schema tables (repos, deletion_logs)
    // alongside public-schema tables (Better Auth). See: prisma/prisma#28611
    const searchPath = "kap10,public"
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
}

export default PrismaRelationalStore
