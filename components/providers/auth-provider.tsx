"use client"

import { createContext, type ReactNode, useContext } from "react"
import { useSession } from "@/lib/auth/client"

interface AuthContextType {
  session: ReturnType<typeof useSession>["data"]
  isPending: boolean
  error: ReturnType<typeof useSession>["error"]
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = useSession()

  return (
    <AuthContext.Provider value={{ session, isPending, error }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
