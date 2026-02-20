import { headers } from "next/headers"
import { listOrganizations } from "@/lib/auth"

export async function getActiveOrgId(): Promise<string> {
  const orgs = await listOrganizations(await headers())
  const orgId = orgs[0]?.id
  if (!orgId) {
    throw new Error("No active organization found. Every user should have an auto-provisioned organization.")
  }
  return orgId
}
