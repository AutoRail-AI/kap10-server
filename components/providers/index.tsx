"use client"

import { ThemeProvider } from "next-themes"
import { type ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { AnalyticsProvider } from "./analytics-provider"
import { AuthProvider } from "./auth-provider"

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <AuthProvider>
        <AnalyticsProvider>
          {children}
          <Toaster position="top-right" richColors />
        </AnalyticsProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export { AccountProvider, useAccountContext, type OrgAccount } from "./account-context"
export { AuthProvider, useAuth } from "./auth-provider"
