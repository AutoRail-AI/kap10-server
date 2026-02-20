"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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
  currentContextName: string
  activeOrgId: string
  organizations: OrgAccount[]
  switchContext: (orgId: string) => Promise<void>
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

  const activeOrgId = activeOrg?.id ?? organizations[0]?.id ?? ""

  // Self-healing: if no active org but orgs exist, auto-activate the first one
  useEffect(() => {
    if (!activeOrg && organizations.length > 0 && organizations[0]) {
      void authClient.organization.setActive({
        organizationId: organizations[0].id,
      })
    }
  }, [activeOrg, organizations])

  const switchContext = useCallback(
    async (orgId: string) => {
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
    if (activeOrg) return activeOrg.name
    if (organizations[0]) return organizations[0].name
    return ""
  }, [activeOrg, organizations])

  const value = useMemo<AccountContextValue>(
    () => ({
      currentContextName,
      activeOrgId,
      organizations,
      switchContext,
      isLoading,
    }),
    [
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
