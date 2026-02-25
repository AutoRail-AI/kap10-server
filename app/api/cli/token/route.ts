/**
 * POST /api/cli/token — RFC 8628 token exchange endpoint.
 *
 * The CLI polls this with a device_code until the user approves
 * in the browser. On approval, returns the org's default API key.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { generateApiKey } from "@/lib/mcp/auth"

interface DeviceState {
  userCode: string
  status: "pending" | "approved"
  createdAt: number
  userId?: string
  orgId?: string
  orgName?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    device_code?: string
    grant_type?: string
  }

  if (body.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    )
  }

  if (!body.device_code) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "device_code is required" },
      { status: 400 }
    )
  }

  const container = getContainer()
  const cacheStore = container.cacheStore

  const state = await cacheStore.get<DeviceState>(
    `cli:device:${body.device_code}`
  )

  if (!state) {
    return NextResponse.json({ error: "expired_token" }, { status: 400 })
  }

  if (state.status === "pending") {
    return NextResponse.json(
      { error: "authorization_pending" },
      { status: 400 }
    )
  }

  // Status is "approved" — exchange for API key
  const orgId = state.orgId!
  const relationalStore = container.relationalStore

  // Get or create default API key for the org
  let defaultKey = await relationalStore.getDefaultApiKey(orgId)
  let rawKey: string | undefined

  if (!defaultKey) {
    const { raw, hash, prefix } = generateApiKey()
    rawKey = raw
    defaultKey = await relationalStore.createApiKey({
      organizationId: orgId,
      name: "Default CLI Key",
      keyPrefix: prefix,
      keyHash: hash,
      scopes: ["mcp:read", "mcp:sync"],
      isDefault: true,
    })
  }

  // Clean up the device code from Redis
  await cacheStore.invalidate(`cli:device:${body.device_code}`)
  await cacheStore.invalidate(`cli:usercode:${state.userCode}`)

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.unerr.dev"

  return NextResponse.json({
    access_token: rawKey ?? defaultKey.keyPrefix, // raw key only on first creation
    token_type: "Bearer",
    org_id: orgId,
    org_name: state.orgName ?? "",
    server_url: serverUrl,
    // If key already existed, CLI must already have it stored
    key_already_existed: !rawKey,
  })
}
