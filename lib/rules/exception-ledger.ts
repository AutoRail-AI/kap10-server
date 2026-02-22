/**
 * Rule Exception Ledger — time-bound TTL exemptions CRUD.
 */

import type { Container } from "@/lib/di/container"
import type { RuleExceptionDoc } from "@/lib/ports/types"

export async function createException(
  container: Container,
  orgId: string,
  ruleId: string,
  opts: {
    entityId?: string
    filePath?: string
    reason: string
    createdBy: string
    ttlDays?: number
  }
): Promise<RuleExceptionDoc> {
  const crypto = require("node:crypto") as typeof import("node:crypto")
  const now = new Date()
  const ttlDays = opts.ttlDays ?? 30

  const exception: RuleExceptionDoc = {
    id: crypto.randomUUID().slice(0, 16),
    org_id: orgId,
    rule_id: ruleId,
    entity_id: opts.entityId,
    file_path: opts.filePath,
    reason: opts.reason,
    created_by: opts.createdBy,
    expires_at: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    created_at: now.toISOString(),
  }

  await container.graphStore.upsertRuleException(orgId, exception)
  return exception
}

export async function getActiveExceptions(
  container: Container,
  orgId: string,
  ruleId: string
): Promise<RuleExceptionDoc[]> {
  const exceptions = await container.graphStore.queryRuleExceptions(orgId, ruleId)
  const now = new Date()
  const active = exceptions.filter((e) => {
    if (e.status !== "active") return false
    if (new Date(e.expires_at) < now) return false
    return true
  })
  return active
}

export async function revokeException(
  container: Container,
  orgId: string,
  exceptionId: string
): Promise<void> {
  await container.graphStore.updateRuleException(orgId, exceptionId, "revoked")
}

export function isExempt(
  exceptions: RuleExceptionDoc[],
  entityId?: string,
  filePath?: string
): boolean {
  const now = new Date()
  return exceptions.some((e) => {
    if (e.status !== "active") return false
    if (new Date(e.expires_at) < now) return false
    // Global exception for the rule
    if (!e.entity_id && !e.file_path) return true
    // Entity-specific exception
    if (e.entity_id && e.entity_id === entityId) return true
    // File-specific exception
    if (e.file_path && e.file_path === filePath) return true
    return false
  })
}
