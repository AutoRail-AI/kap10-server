import { headers } from "next/headers"
import { listOrganizations } from "@/lib/auth"

export async function getActiveOrgId(): Promise<string | null> {
  const orgs = await listOrganizations(await headers())
  return orgs[0]?.id ?? null
}
