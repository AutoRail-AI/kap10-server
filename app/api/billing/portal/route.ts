import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getOrCreateCustomer, createPortalSession } from "@/lib/billing/stripe"

export async function POST(req: NextRequest) {
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

