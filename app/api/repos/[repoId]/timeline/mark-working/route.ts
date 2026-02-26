/**
 * Phase 5.5: Mark a ledger entry as "working" and create a WorkingSnapshot.
 */

import { NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { validateLedgerTransition } from "@/lib/ports/types"
import type { SnapshotFile, WorkingSnapshot } from "@/lib/ports/types"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

interface MarkWorkingBody {
  entryId: string
  files: Array<{ file_path: string; content: string }>
}

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  const container = getContainer()

  // Extract repoId from URL
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const repoIdx = segments.indexOf("repos")
  const repoId = segments[repoIdx + 1]
  if (!repoId) {
    return errorResponse("Missing repoId", 400)
  }

  // Verify repo belongs to org
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  // Parse and validate body
  const body = (await req.json()) as MarkWorkingBody
  const { entryId, files } = body

  if (!entryId) {
    return errorResponse("Missing entryId in request body", 400)
  }
  if (!Array.isArray(files)) {
    return errorResponse("Missing files array in request body", 400)
  }

  // Load existing entry
  const entry = await container.graphStore.getLedgerEntry(orgId, entryId)
  if (!entry) {
    return errorResponse("Ledger entry not found", 404)
  }
  if (entry.repo_id !== repoId) {
    return errorResponse("Ledger entry not found", 404)
  }

  // Validate state transition
  if (!validateLedgerTransition(entry.status, "working")) {
    return errorResponse(
      `Invalid status transition from "${entry.status}" to "working"`,
      422
    )
  }

  // Update status to working
  await container.graphStore.updateLedgerEntryStatus(orgId, entryId, "working")

  // Create a WorkingSnapshot
  const snapshotId = randomUUID()
  const snapshotFiles: SnapshotFile[] = files.map((f) => ({
    file_path: f.file_path,
    content: f.content,
    entity_hashes: [],
  }))

  const snapshot: WorkingSnapshot = {
    id: snapshotId,
    org_id: orgId,
    repo_id: repoId,
    user_id: entry.user_id,
    branch: entry.branch,
    timeline_branch: entry.timeline_branch,
    ledger_entry_id: entryId,
    reason: "user_marked",
    files: snapshotFiles,
    created_at: new Date().toISOString(),
  }

  await container.graphStore.appendWorkingSnapshot(orgId, snapshot)

  return successResponse({ status: "marked", snapshotId })
})
