import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getCostSummary } from "@/lib/cost/tracker"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const provider = searchParams.get("provider")
  const model = searchParams.get("model")
  const startDate = searchParams.get("startDate")
    ? new Date(searchParams.get("startDate")!)
    : undefined
  const endDate = searchParams.get("endDate")
    ? new Date(searchParams.get("endDate")!)
    : undefined

  const summary = await getCostSummary({
    userId: session.user.id,
    organizationId: organizationId || undefined,
    provider: provider || undefined,
    model: model || undefined,
    startDate,
    endDate,
  })

  return NextResponse.json(summary)
}

