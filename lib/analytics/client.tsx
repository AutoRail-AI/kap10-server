"use client"

import { useEffect } from "react"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthog: any = null

if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  posthog = require("posthog-js")
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      posthog &&
      process.env.NEXT_PUBLIC_POSTHOG_KEY &&
      process.env.NEXT_PUBLIC_POSTHOG_HOST
    ) {
      posthog.default.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loaded: (ph: any) => {
          if (process.env.NODE_ENV === "development") {
            ph.debug()
          }
        },
      })
    }
  }, [])

  return <>{children}</>
}

// Client-side event tracking
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackEvent(event: string, properties?: Record<string, any>) {
  if (typeof window !== "undefined" && posthog?.default) {
    posthog.default.capture(event, properties)
  }
}

// Identify user
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function identifyUser(distinctId: string, properties?: Record<string, any>) {
  if (typeof window !== "undefined" && posthog?.default) {
    posthog.default.identify(distinctId, properties)
  }
}

// Reset (on logout)
export function resetPostHog() {
  if (typeof window !== "undefined" && posthog?.default) {
    posthog.default.reset()
  }
}

