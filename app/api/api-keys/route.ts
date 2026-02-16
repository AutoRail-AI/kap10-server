import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import {
  createApiKey,
  getApiKeys,
  revokeApiKey,
} from "@/lib/api-keys/manager"
import { auth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const keys = await getApiKeys(session.user.id)

  // Don't expose full keys, only prefixes
  return NextResponse.json(
    keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.key_prefix,
      lastUsedAt: key.last_used_at,
      expiresAt: key.expires_at,
      scopes: key.scopes,
      enabled: key.enabled,
      createdAt: key.created_at,
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    name?: string
    organizationId?: string
    scopes?: string[]
    expiresAt?: string
    rateLimit?: { windowMs: number; maxRequests: number }
  }
  const { name, organizationId, scopes, expiresAt, rateLimit } = body

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const result = await createApiKey(session.user.id, name, {
    organizationId,
    scopes,
    expiresAt: expiresAt || undefined,
    rateLimit,
  })

  // Return raw key only once (user should save it)
  return NextResponse.json({
    id: result.id,
    name: result.name,
    key: result.rawKey,
    keyPrefix: result.key_prefix,
    scopes: result.scopes,
    expiresAt: result.expires_at,
    createdAt: result.created_at,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const keyId = searchParams.get("id")

  if (!keyId) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 })
  }

  await revokeApiKey(keyId)

  return NextResponse.json({ success: true })
}
