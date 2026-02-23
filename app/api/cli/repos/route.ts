/**
 * POST /api/cli/repos — Add GitHub repos and trigger indexing from CLI.
 *
 * Auth: API key (Bearer kap10_sk_...)
 *
 * Accepts a list of GitHub repo IDs, validates them against the org's
 * installations, creates repo records, and starts indexing workflows.
 * Mirrors POST /api/repos but uses API key auth.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"
import { logger } from "@/lib/utils/logger"

const MAX_REPOS_PER_ORG = 50
const MAX_CONCURRENT_INDEXING = 3

const log = logger.child({ service: "cli-repos" })

export async function POST(request: Request) {
  const container = getContainer()

  const authResult = await authenticateMcpRequest(
    request.headers.get("authorization"),
    container.cacheStore,
    container.relationalStore
  )
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status })
  }

  const orgId = authResult.orgId

  const body = (await request.json()) as {
    repos: Array<{ githubRepoId: number; branch?: string }>
  }

  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json(
      { error: "repos array is required with at least one entry" },
      { status: 400 }
    )
  }

  const githubRepoIds = body.repos.map((r) => r.githubRepoId)
  const branchOverrides = new Map(
    body.repos.filter((r) => r.branch).map((r) => [r.githubRepoId, r.branch as string])
  )

  const installations = await container.relationalStore.getInstallations(orgId)
  if (installations.length === 0) {
    return NextResponse.json(
      { error: "GitHub App not installed for this organization" },
      { status: 400 }
    )
  }

  const existingRepos = await container.relationalStore.getRepos(orgId)
  if (existingRepos.length + githubRepoIds.length > MAX_REPOS_PER_ORG) {
    return NextResponse.json(
      { error: `Maximum ${MAX_REPOS_PER_ORG} repos per organization` },
      { status: 400 }
    )
  }

  const indexing = await container.relationalStore.getReposByStatus(orgId, "indexing")
  if (indexing.length >= MAX_CONCURRENT_INDEXING) {
    return NextResponse.json(
      { error: `Maximum ${MAX_CONCURRENT_INDEXING} concurrent indexing workflows. Try again later.` },
      { status: 429 }
    )
  }

  // Build map of github repo id → metadata from installations
  const repoInstMap = new Map<
    number,
    { fullName: string; defaultBranch: string; installationId: number }
  >()
  for (const inst of installations) {
    const repos = await container.gitHost.getInstallationRepos(inst.installationId)
    for (const r of repos) {
      if (!repoInstMap.has(r.id)) {
        repoInstMap.set(r.id, {
          fullName: r.fullName,
          defaultBranch: r.defaultBranch,
          installationId: inst.installationId,
        })
      }
    }
  }

  const existingIds = new Set(
    existingRepos.map((r) => r.githubRepoId).filter((id): id is number => id != null)
  )
  const toAdd = githubRepoIds.filter((id) => repoInstMap.has(id) && !existingIds.has(id))

  // For repos that already exist, return them directly
  const alreadyExisting = githubRepoIds
    .filter((id) => existingIds.has(id))
    .map((id) => {
      const repo = existingRepos.find((r) => r.githubRepoId === id)
      return repo ? { id: repo.id, name: repo.name, fullName: repo.fullName, status: repo.status } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const workflowEngine = container.workflowEngine
  const created: Array<{ id: string; name: string; fullName: string; status: string }> = []

  for (const ghRepoId of toAdd) {
    const meta = repoInstMap.get(ghRepoId)
    const fullName = meta?.fullName ?? `repo-${ghRepoId}`
    const name = fullName.split("/").pop() ?? fullName
    const providerId = String(ghRepoId)
    const chosenBranch = branchOverrides.get(ghRepoId) ?? meta?.defaultBranch ?? "main"

    const repo = await container.relationalStore.createRepo({
      organizationId: orgId,
      name,
      fullName,
      provider: "github",
      providerId,
      status: "pending",
      defaultBranch: chosenBranch,
      githubRepoId: ghRepoId,
      githubFullName: fullName,
    })

    const installationId = meta?.installationId ?? installations[0]?.installationId ?? 0
    const workflowId = `index-${orgId}-${repo.id}`

    try {
      await workflowEngine.startWorkflow({
        workflowId,
        workflowFn: "indexRepoWorkflow",
        args: [{
          orgId,
          repoId: repo.id,
          installationId,
          cloneUrl: `https://github.com/${fullName}.git`,
          defaultBranch: repo.defaultBranch ?? "main",
        }],
        taskQueue: "heavy-compute-queue",
      })
      await container.relationalStore.updateRepoStatus(repo.id, {
        status: "indexing",
        workflowId,
      })
      created.push({ id: repo.id, name: repo.name, fullName: repo.fullName, status: "indexing" })
      log.info("Started indexing", { orgId, repoId: repo.id, fullName })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await container.relationalStore.updateRepoStatus(repo.id, {
        status: "error",
        errorMessage: message,
      })
      created.push({ id: repo.id, name: repo.name, fullName: repo.fullName, status: "error" })
      log.error("Failed to start indexing", err instanceof Error ? err : undefined, { orgId, repoId: repo.id })
    }
  }

  return NextResponse.json({
    created,
    alreadyExisting,
    indexingStarted: created.some((c) => c.status === "indexing"),
  })
}
