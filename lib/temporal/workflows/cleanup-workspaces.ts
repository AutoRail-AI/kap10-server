/**
 * Workspace cleanup cron workflow — runs every 15 minutes.
 * Removes expired workspace overlays from ArangoDB and Supabase.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as activities from "../activities/workspace-cleanup"

const { cleanupExpiredWorkspacesActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
  retry: {
    maximumAttempts: 3,
  },
})

/**
 * Cron workflow that cleans up expired workspaces.
 * Schedule: every 15 minutes.
 */
export async function cleanupWorkspacesWorkflow(): Promise<number> {
  return cleanupExpiredWorkspacesActivity()
}
