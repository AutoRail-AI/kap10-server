import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const MAX_REPOS_PER_ORG = 50
const MAX_CONCURRENT_INDEXING = 3

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }
  const container = getContainer()
  const repos = await container.relationalStore.getRepos(orgId)
  return successResponse({ repos })
})

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const body = (await req.json()) as {
    githubRepoIds?: number[]
    repos?: Array<{ githubRepoId: number; branch?: string }>
  }

  // Support both new format { repos: [...] } and legacy { githubRepoIds: [...] }
  const repoInputs: Array<{ githubRepoId: number; branch?: string }> =
    Array.isArray(body.repos) && body.repos.length > 0
      ? body.repos
      : Array.isArray(body.githubRepoIds) && body.githubRepoIds.length > 0
        ? body.githubRepoIds.map((id) => ({ githubRepoId: id }))
        : []

  if (repoInputs.length === 0) {
    return errorResponse("repos array or githubRepoIds array is required", 400)
  }

  const githubRepoIds = repoInputs.map((r) => r.githubRepoId)
  const branchOverrides = new Map(
    repoInputs.filter((r) => r.branch).map((r) => [r.githubRepoId, r.branch as string])
  )

  const container = getContainer()
  const installations = await container.relationalStore.getInstallations(orgId)
  if (installations.length === 0) {
    return errorResponse("GitHub App not installed for this organization", 400)
  }

  const existingRepos = await container.relationalStore.getRepos(orgId)
  if (existingRepos.length + githubRepoIds.length > MAX_REPOS_PER_ORG) {
    return errorResponse(`Maximum ${MAX_REPOS_PER_ORG} repos per organization`, 400)
  }

  const indexing = await container.relationalStore.getReposByStatus(orgId, "indexing")
  if (indexing.length >= MAX_CONCURRENT_INDEXING) {
    return errorResponse(`Maximum ${MAX_CONCURRENT_INDEXING} concurrent indexing workflows`, 429)
  }

  const repoInstMap = new Map<number, { fullName: string; defaultBranch: string; installationId: number }>()
  for (const inst of installations) {
    const repos = await container.gitHost.getInstallationRepos(inst.installationId)
    for (const r of repos) {
      if (!repoInstMap.has(r.id)) {
        repoInstMap.set(r.id, { fullName: r.fullName, defaultBranch: r.defaultBranch, installationId: inst.installationId })
      }
    }
  }

  const existingIds = new Set(existingRepos.map((r) => r.githubRepoId).filter(Boolean) as number[])
  const toAdd = githubRepoIds.filter((id) => repoInstMap.has(id) && !existingIds.has(id))

  const workflowEngine = container.workflowEngine
  const created: { id: string; name: string; status: string }[] = []

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
    created.push({ id: repo.id, name: repo.name, status: repo.status })

    const installationId = meta?.installationId ?? installations[0]?.installationId ?? 0
    const workflowId = `index-${orgId}-${repo.id}`
    const runId = randomUUID()
    try {
      // Create pipeline run record before starting workflow
      await container.relationalStore.createPipelineRun({
        id: runId,
        repoId: repo.id,
        organizationId: orgId,
        workflowId,
        triggerType: "initial",
        pipelineType: "full",
      })

      await workflowEngine.startWorkflow({
        workflowId,
        workflowFn: "indexRepoWorkflow",
        args: [{
          orgId,
          repoId: repo.id,
          installationId,
          cloneUrl: `https://github.com/${fullName}.git`,
          defaultBranch: repo.defaultBranch ?? "main",
          runId,
        }],
        taskQueue: "heavy-compute-queue",
      })
      await container.relationalStore.updateRepoStatus(repo.id, {
        status: "indexing",
        workflowId,
      })
      const c = created.find((x) => x.id === repo.id)
      if (c) c.status = "indexing"
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await container.relationalStore.updateRepoStatus(repo.id, {
        status: "error",
        errorMessage: message,
      })
      const c = created.find((x) => x.id === repo.id)
      if (c) c.status = "error"
    }
  }

  revalidatePath("/repos")
  return successResponse({
    repos: await container.relationalStore.getRepos(orgId),
    created,
    indexingStarted: created.some((c) => c.status === "indexing"),
  })
})
