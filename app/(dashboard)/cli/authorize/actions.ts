"use server"

import { getActiveOrgId, getOrgsCached, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

interface AuthorizeResult {
  success: boolean
  error?: string
}

export async function authorizeDevice(userCode: string): Promise<AuthorizeResult> {
  const session = await getSessionCached()
  if (!session) {
    return { success: false, error: "Not authenticated" }
  }

  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    return { success: false, error: "No organization context" }
  }

  // Get org name
  let orgName = ""
  try {
    const memberOrgs = await getOrgsCached()
    orgName = memberOrgs.find((o) => o.id === orgId)?.name ?? ""
  } catch {
    // Non-critical — continue without org name
  }

  const container = getContainer()
  const cacheStore = container.cacheStore

  // Look up device_code from user_code
  const deviceCode = await cacheStore.get<string>(`cli:usercode:${userCode}`)
  if (!deviceCode) {
    return { success: false, error: "Code expired or invalid. Please run the CLI command again." }
  }

  // Update device state to approved
  await cacheStore.set(
    `cli:device:${deviceCode}`,
    {
      userCode,
      status: "approved",
      createdAt: Date.now(),
      userId: session.user.id,
      orgId,
      orgName,
    },
    600 // Keep for 10 minutes for the CLI to pick it up
  )

  return { success: true }
}
