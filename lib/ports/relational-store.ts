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
  createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
  }): Promise<RepoRecord>
  getDeletionLogs(orgId: string, limit?: number): Promise<DeletionLogRecord[]>
}
