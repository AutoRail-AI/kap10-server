"use client"

import { type ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "./auth-provider"
import { AnalyticsProvider } from "./analytics-provider"

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <AnalyticsProvider>
        {children}
        <Toaster position="top-right" richColors />
      </AnalyticsProvider>
    </AuthProvider>
  )
}

export { AuthProvider, useAuth } from "./auth-provider"
