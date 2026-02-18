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
  DeletionLogRecord,
  GitHubInstallationRecord,
  IRelationalStore,
  RepoRecord,
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
    })
    if (!row) return null
    return this.mapInstallation(row)
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
}

export default PrismaRelationalStore
