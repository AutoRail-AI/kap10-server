"use client"

import { useEffect } from "react"
import { PostHogProvider } from "@/lib/analytics/client"
import { authClient } from "@/lib/auth/client"

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession()

  useEffect(() => {
    if (session?.user) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { identifyUser } = require("@/lib/analytics/client")
      identifyUser(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      })
    }
  }, [session])

  return <PostHogProvider>{children}</PostHogProvider>
}

