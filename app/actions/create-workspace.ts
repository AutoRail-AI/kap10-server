"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth, createOrganizationForUser, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { createOrgUseCase } from "@/lib/use-cases/create-org"

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 48)
}

/**
 * Auto-create a workspace for the current user using their display name.
 * Redirects to the dashboard on success. No-op if the user already has a workspace.
 */
export async function createDefaultWorkspace() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    redirect("/login")
  }

  const orgs = await listOrganizations(reqHeaders)
  if (orgs.length > 0) {
    redirect("/")
  }

  const displayName = session.user.name ?? session.user.email.split("@")[0] ?? "My"
  const wsName = `${displayName}'s workspace`
  const wsSlug = slugify(displayName) || "workspace"

  const newOrg = await createOrganizationForUser(reqHeaders, wsName, wsSlug)

  const container = getContainer()
  await createOrgUseCase(container, { organizationId: newOrg.id, name: wsName })

  redirect("/")
}
