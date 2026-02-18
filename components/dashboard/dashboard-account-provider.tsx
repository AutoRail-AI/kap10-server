"use client"

import { type ReactNode } from "react"
import { AccountProvider } from "@/components/providers/account-context"

/**
 * Wraps dashboard content with AccountProvider so org hooks (useListOrganizations,
 * useActiveOrganization) only run when the user is logged in and on a dashboard page.
 * This avoids 401s from /api/auth/organization/* on login/register pages.
 */
export function DashboardAccountProvider({ children }: { children: ReactNode }) {
  return <AccountProvider>{children}</AccountProvider>
}
