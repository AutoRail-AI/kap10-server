import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params
  const container = getContainer()

  const url = new URL(req.url)
  const branch = url.searchParams.get("branch") ?? undefined
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)

  // Get org from repo (need orgId for graph store queries)
  const repo = await container.relationalStore.getRepo("", repoId)
  if (!repo) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 })
  }

  const summaries = await container.graphStore.queryLedgerSummaries(
    repo.organizationId,
    repoId,
    branch,
    limit
  )

  // Filter to merge summaries (those with PR references)
  const mergeHistory = summaries
    .filter((s) => s.commit_sha.startsWith("pr-") || s.prompt_summary.startsWith("Merge PR"))
    .map((s) => ({
      id: s.id,
      commitSha: s.commit_sha,
      branch: s.branch,
      entryCount: s.entry_count,
      narrative: s.prompt_summary,
      totalFilesChanged: s.total_files_changed,
      totalLinesAdded: s.total_lines_added,
      totalLinesRemoved: s.total_lines_removed,
      rewindCount: s.rewind_count,
      createdAt: s.created_at,
    }))

  return NextResponse.json({ items: mergeHistory })
}
