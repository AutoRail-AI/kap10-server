import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api-keys/manager"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId") || undefined

  const keys = await listApiKeys(session.user.id, organizationId)

  // Don't expose full keys, only prefixes
  return NextResponse.json(
    keys.map((key) => ({
      id: key._id.toString(),
      name: key.name,
      keyPrefix: key.keyPrefix,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      scopes: key.scopes,
      enabled: key.enabled,
      createdAt: key.createdAt,
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { name, organizationId, scopes, expiresAt, rateLimit } = body

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const { apiKey, plainKey } = await createApiKey(session.user.id, name, {
    organizationId,
    scopes,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    rateLimit,
  })

  // Return plain key only once (user should save it)
  return NextResponse.json({
    id: apiKey._id.toString(),
    name: apiKey.name,
    key: plainKey, // Only returned once
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
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

  await revokeApiKey(keyId, session.user.id)

  return NextResponse.json({ success: true })
}

