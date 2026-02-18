"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import { authClient } from "@/lib/auth/client"

export interface OrgAccount {
  id: string
  name: string
  slug: string
}

interface AccountContextValue {
  contextType: "personal" | "organization"
  currentContextName: string
  activeOrgId: string | null
  organizations: OrgAccount[]
  switchContext: (orgId: string | null) => Promise<void>
  isLoading: boolean
}

const Ctx = createContext<AccountContextValue | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const { data: activeOrg } = authClient.useActiveOrganization()
  const { data: orgList } = authClient.useListOrganizations()

  const organizations = useMemo<OrgAccount[]>(() => {
    if (!orgList) return []
    return orgList.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
    }))
  }, [orgList])

  const activeOrgId = activeOrg?.id ?? null
  const contextType: "personal" | "organization" = activeOrgId
    ? "organization"
    : "personal"

  const switchContext = useCallback(
    async (orgId: string | null) => {
      setIsLoading(true)
      try {
        await authClient.organization.setActive({
          organizationId: orgId,
        })
        router.refresh()
      } catch (error: unknown) {
        console.error(
          "Failed to switch context:",
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        setIsLoading(false)
      }
    },
    [router]
  )

  const currentContextName = useMemo(() => {
    if (contextType === "organization" && activeOrg) {
      return activeOrg.name
    }
    return "Personal"
  }, [contextType, activeOrg])

  const value = useMemo<AccountContextValue>(
    () => ({
      contextType,
      currentContextName,
      activeOrgId,
      organizations,
      switchContext,
      isLoading,
    }),
    [
      contextType,
      currentContextName,
      activeOrgId,
      organizations,
      switchContext,
      isLoading,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccountContext() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error("useAccountContext must be used within AccountProvider")
  }
  return ctx
}
