import { cache } from "react"
import { headers } from "next/headers"
import { auth, listOrganizations } from "@/lib/auth"
import type { OrgListItem, Session } from "@/lib/auth"

/**
 * Cached session resolver — deduplicates across all server components in one request.
 * React's cache() ensures that even if layout.tsx + page.tsx both call this,
 * the actual auth.api.getSession() call only happens once.
 */
export const getSessionCached = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() })
})

/**
 * Cached organization list — deduplicates listOrganizations() calls in one request.
 * Layout, page, and nested server components all share a single DB/auth call.
 */
export const getOrgsCached = cache(async (): Promise<OrgListItem[]> => {
  return listOrganizations(await headers())
})

/**
 * Get the active organization ID for the current request.
 * Uses React cache() internally — safe to call from multiple server components
 * in the same render without triggering redundant DB queries.
 */
export async function getActiveOrgId(): Promise<string> {
  const orgs = await getOrgsCached()
  const orgId = orgs[0]?.id
  if (!orgId) {
    throw new Error("No active organization found. Every user should have an auto-provisioned organization.")
  }
  return orgId
}
