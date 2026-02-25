/**
 * POST /api/cli/device-code — RFC 8628 Device Authorization Grant.
 *
 * Generates a device_code + user_code pair for CLI authentication.
 * The CLI polls /api/cli/token with the device_code until the user
 * approves via the browser at /cli/authorize.
 */

import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { getContainer } from "@/lib/di/container"

function generateUserCode(): string {
  // 8 uppercase alphanumeric, formatted as XXXX-XXXX
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1 for readability
  let code = ""
  const bytes = randomBytes(8)
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length]
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export async function POST() {
  const container = getContainer()
  const cacheStore = container.cacheStore

  const deviceCode = randomBytes(32).toString("base64url")
  const userCode = generateUserCode()
  const expiresIn = 600 // 10 minutes

  // Store device code state in Redis
  await cacheStore.set(
    `cli:device:${deviceCode}`,
    { userCode, status: "pending", createdAt: Date.now() },
    expiresIn
  )

  // Reverse lookup: user_code → device_code
  await cacheStore.set(`cli:usercode:${userCode}`, deviceCode, expiresIn)

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.unerr.dev"

  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${serverUrl}/cli/authorize`,
    expires_in: expiresIn,
    interval: 5,
  })
}
