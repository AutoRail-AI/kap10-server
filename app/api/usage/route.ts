import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getUsageStats, checkQuota } from "@/lib/usage/tracker"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const type = searchParams.get("type")
  const resource = searchParams.get("resource")
  const startDate = searchParams.get("startDate")
    ? new Date(searchParams.get("startDate")!)
    : undefined
  const endDate = searchParams.get("endDate")
    ? new Date(searchParams.get("endDate")!)
    : undefined

  const stats = await getUsageStats({
    userId: session.user.id,
    organizationId: organizationId || undefined,
    type: type as any,
    resource: resource || undefined,
    startDate,
    endDate,
  })

  return NextResponse.json(stats)
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { limit, windowMs, type, resource, organizationId } = body

  if (!limit || !windowMs || !type) {
    return NextResponse.json(
      { error: "limit, windowMs, and type are required" },
      { status: 400 }
    )
  }

  const result = await checkQuota(
    session.user.id,
    organizationId,
    { limit, windowMs, type, resource }
  )

  return NextResponse.json(result)
}

