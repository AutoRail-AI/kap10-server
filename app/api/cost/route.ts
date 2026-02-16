import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCostsByProvider, getTotalCost } from "@/lib/cost/tracker"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const startDate = searchParams.get("startDate") || undefined
  const endDate = searchParams.get("endDate") || undefined

  const [totalCost, byProvider] = await Promise.all([
    getTotalCost({
      userId: session.user.id,
      organizationId: organizationId || undefined,
      startDate,
      endDate,
    }),
    getCostsByProvider({
      userId: session.user.id,
      organizationId: organizationId || undefined,
      startDate,
      endDate,
    }),
  ])

  return NextResponse.json({ ...totalCost, byProvider })
}
