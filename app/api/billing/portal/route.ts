import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createPortalSession, getOrCreateCustomer } from "@/lib/billing/stripe"

export async function POST(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get or create Stripe customer
    const customer = await getOrCreateCustomer(
      session.user.id,
      session.user.email,
      session.user.name || undefined
    )

    // Create portal session
    const portalSession = await createPortalSession(customer.id)

    return NextResponse.json({
      url: portalSession.url,
    })
  } catch (error) {
    console.error("Portal error:", error)
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    )
  }
}

