import { PostHog } from "posthog-node"

let posthogServer: PostHog | null = null

export function getPostHogServer(): PostHog | null {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return null
  }

  if (!posthogServer) {
    posthogServer = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
      flushAt: 20,
      flushInterval: 10000,
    })
  }

  return posthogServer
}

// Server-side event tracking
export async function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, any>
): Promise<void> {
  const client = getPostHogServer()
  if (!client) return

  client.capture({
    distinctId,
    event,
    properties: {
      ...properties,
      timestamp: new Date().toISOString(),
    },
  })
}

// Identify user
export async function identifyUser(
  distinctId: string,
  properties?: Record<string, any>
): Promise<void> {
  const client = getPostHogServer()
  if (!client) return

  client.identify({
    distinctId,
    properties,
  })
}

// Group identify (for organizations)
export async function identifyGroup(
  groupType: string,
  groupKey: string,
  properties?: Record<string, any>
): Promise<void> {
  const client = getPostHogServer()
  if (!client) return

  client.groupIdentify({
    groupType,
    groupKey,
    properties,
  })
}

