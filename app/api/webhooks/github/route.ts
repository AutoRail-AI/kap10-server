import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

const WEBHOOK_DEDUPE_TTL = 86400

export async function POST(req: NextRequest) {
  const delivery = req.headers.get("x-github-delivery")
  const signature = req.headers.get("x-hub-signature-256")
  if (!delivery || !signature) {
    return NextResponse.json({ error: "Missing headers" }, { status: 401 })
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  const raw = await req.text()
  const crypto = await import("node:crypto")
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const container = getContainer()
  const dedupeKey = `webhook:gh:${delivery}`
  const set = await container.cacheStore.setIfNotExists(dedupeKey, "1", WEBHOOK_DEDUPE_TTL)
  if (!set) {
    return NextResponse.json({ ok: true })
  }

  let payload: { action?: string; installation?: { id: number } }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = req.headers.get("x-github-event")
  if (event === "installation" && payload.action === "deleted" && payload.installation?.id) {
    const inst = await container.relationalStore.getInstallationByInstallationId(payload.installation.id)
    if (inst) {
      await container.relationalStore.deleteInstallationById(inst.id)
    }
  }
  // installation_repositories events are ignored — repos are only added
  // when the user explicitly selects them via the repo picker (POST /api/repos).

  return NextResponse.json({ ok: true })
}
