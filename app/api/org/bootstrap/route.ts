"use server"

import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { createOrgUseCase } from "@/lib/use-cases/create-org"

export const POST = withAuth(async (req: NextRequest, { session }) => {
  const body = (await req.json()) as { organizationId?: string; name?: string }
  const { organizationId, name } = body
  if (!organizationId || !name) {
    return NextResponse.json(
      { error: "organizationId and name are required" },
      { status: 400 }
    )
  }

  const container = getContainer()
  const result = await createOrgUseCase(container, { organizationId, name })

  return NextResponse.json(result, { status: 200 })
})
