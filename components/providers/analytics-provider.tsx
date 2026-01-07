"use client"

import { PostHogProvider } from "@/lib/analytics/client"
import { useEffect } from "react"
import { authClient } from "@/lib/auth/client"

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession()

  useEffect(() => {
    if (session?.user) {
      const { identifyUser } = require("@/lib/analytics/client")
      identifyUser(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      })
    }
  }, [session])

  return <PostHogProvider>{children}</PostHogProvider>
}

