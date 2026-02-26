/**
 * Temporal activities for Auto-PR onboarding.
 * Runs on the light-llm-queue after first successful indexing.
 */

import { type Container, getContainer } from "@/lib/di/container"
import { createOnboardingPr } from "@/lib/onboarding/auto-pr"

let _testContainer: Container | null = null

/** @internal — for unit tests only */
export function __setTestContainer(c: Container) { _testContainer = c }
export function __resetTestContainer() { _testContainer = null }

function resolveContainer(): Container {
  return _testContainer ?? getContainer()
}

/**
 * Create an onboarding PR for a repo that just finished indexing.
 * Checks: repo status is "ready" AND onboardingPrUrl IS NULL.
 */
export async function createOnboardingPrActivity(
  orgId: string,
  repoId: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const container = resolveContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)

  if (!repo) {
    console.warn(`[Onboarding] Repo ${repoId} not found`)
    return null
  }

  if (repo.status !== "ready") {
    console.log(`[Onboarding] Repo ${repoId} not ready (status: ${repo.status}), skipping`)
    return null
  }

  if (repo.onboardingPrUrl) {
    console.log(`[Onboarding] Repo ${repoId} already has onboarding PR: ${repo.onboardingPrUrl}`)
    return null
  }

  // Get installation token for GitHub API access
  const installation = await container.relationalStore.getInstallation(orgId)
  if (!installation) {
    console.warn(`[Onboarding] No GitHub installation found for org ${orgId}`)
    return null
  }

  const installationToken = await container.gitHost.getInstallationToken(installation.installationId)

  try {
    const result = await createOnboardingPr(repo, installationToken, container)
    console.log(`[Onboarding] Created PR for ${repo.fullName}: ${result.prUrl}`)
    return { prUrl: result.prUrl, prNumber: result.prNumber }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Onboarding] Failed to create PR for ${repo.fullName}:`, message)
    throw error
  }
}
