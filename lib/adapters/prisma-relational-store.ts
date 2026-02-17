/**
 * PrismaRelationalStore — IRelationalStore using Prisma (Supabase PostgreSQL).
 */

import { PrismaClient } from "@prisma/client"
import type { DeletionLogRecord, IRelationalStore, RepoRecord } from "@/lib/ports/relational-store"

let prismaInstance: PrismaClient | null = null

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient()
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

  async getRepos(orgId: string): Promise<RepoRecord[]> {
    const rows = await this.prisma.repo.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })
    return rows.map((r) => ({
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
    }))
  }

  async createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
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
      },
    })
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      fullName: row.fullName,
      provider: row.provider,
      providerId: row.providerId,
      status: row.status,
      defaultBranch: row.defaultBranch,
      lastIndexedAt: row.lastIndexedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
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
