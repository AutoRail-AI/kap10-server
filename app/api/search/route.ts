import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { search } from "@/lib/search/engine"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")
  const organizationId = searchParams.get("organizationId")
  const resource = searchParams.get("resource")
  const tags = searchParams.get("tags")?.split(",")
  const limit = parseInt(searchParams.get("limit") || "20", 10)

  if (!q) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 })
  }

  const results = await search(q, {
    organizationId: organizationId || undefined,
    resource: resource || undefined,
    tags,
    limit,
  })

  return NextResponse.json(results)
}
