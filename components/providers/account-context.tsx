"use client"

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export interface OrgAccount {
  id: string
  name: string
  slug: string
}

export type AccountContext =
  | { type: "personal" }
  | { type: "org"; org: OrgAccount }

interface AccountContextValue {
  activeAccount: AccountContext
  organizations: OrgAccount[]
  setActiveAccount: (account: AccountContext) => void
  setOrganizations: (orgs: OrgAccount[]) => void
  activeOrgId: string | null
}

const STORAGE_KEY = "kap10:active-account"

const Ctx = createContext<AccountContextValue | null>(null)

function readPersistedAccount(): AccountContext {
  if (typeof window === "undefined") return { type: "personal" }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AccountContext
      if (parsed.type === "org" && parsed.org?.id) return parsed
    }
  } catch {
    // corrupted — fall back
  }
  return { type: "personal" }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [activeAccount, setActiveAccountState] =
    useState<AccountContext>(readPersistedAccount)
  const [organizations, setOrganizations] = useState<OrgAccount[]>([])

  const setActiveAccount = useCallback((account: AccountContext) => {
    setActiveAccountState(account)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
    } catch {
      // storage full / SSR — ignore
    }
  }, [])

  useEffect(() => {
    if (activeAccount.type === "org") {
      const stillExists = organizations.some(
        (o) => o.id === activeAccount.org.id
      )
      if (!stillExists && organizations.length > 0) {
        setActiveAccount({ type: "personal" })
      }
    }
  }, [organizations, activeAccount, setActiveAccount])

  const activeOrgId = useMemo(
    () => (activeAccount.type === "org" ? activeAccount.org.id : null),
    [activeAccount]
  )

  const value = useMemo<AccountContextValue>(
    () => ({
      activeAccount,
      organizations,
      setActiveAccount,
      setOrganizations,
      activeOrgId,
    }),
    [activeAccount, organizations, setActiveAccount, setOrganizations, activeOrgId]
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
