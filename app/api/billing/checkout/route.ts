import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createCheckoutSession, getOrCreateCustomer, PLANS } from "@/lib/billing/stripe"
import type { PlanId } from "@/lib/billing/stripe"

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    planId?: string
    organizationId?: string
  }
  const { planId, organizationId } = body

  if (!planId || !PLANS[planId as PlanId]) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }

  const plan = PLANS[planId as PlanId]
  if (!plan.priceId) {
    return NextResponse.json({ error: "Plan not configured" }, { status: 400 })
  }

  try {
    // Get or create Stripe customer
    const customer = await getOrCreateCustomer(
      session.user.id,
      session.user.email,
      session.user.name || undefined
    )

    // Create checkout session
    const checkoutSession = await createCheckoutSession(
      customer.id,
      plan.priceId,
      organizationId
    )

    return NextResponse.json({
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
    })
  } catch (error) {
    console.error("Checkout error:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}

