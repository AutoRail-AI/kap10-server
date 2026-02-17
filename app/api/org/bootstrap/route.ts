"use server"

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { createOrgUseCase } from "@/lib/use-cases/create-org"

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as { organizationId?: string; name?: string }
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[org/bootstrap]", message)
    return NextResponse.json({ error: "Bootstrap failed" }, { status: 500 })
  }
}
