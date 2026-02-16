import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkQuota as checkUsageQuota, getUsageSummary } from "@/lib/usage/tracker"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const startDate = searchParams.get("startDate") || undefined
  const endDate = searchParams.get("endDate") || undefined

  const summary = await getUsageSummary({
    userId: session.user.id,
    organizationId: organizationId || undefined,
    startDate,
    endDate,
  })

  return NextResponse.json(summary)
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    maxQuantity?: number
    type?: string
    windowStartDate?: string
  }
  const { maxQuantity, type, windowStartDate } = body

  if (!maxQuantity || !type || !windowStartDate) {
    return NextResponse.json(
      { error: "maxQuantity, type, and windowStartDate are required" },
      { status: 400 }
    )
  }

  const result = await checkUsageQuota(
    session.user.id,
    type,
    maxQuantity,
    windowStartDate
  )

  return NextResponse.json(result)
}
