import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/billing/stripe"
import {
  updateSubscriptionByStripeSubId,
  createSubscription,
  type SubscriptionInsert,
} from "@/lib/models/billing"
import { getWebhooksForEvent, generateSignature } from "@/lib/webhooks/manager"

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any
        try {
          await updateSubscriptionByStripeSubId(subscription.id, {
            user_id: subscription.metadata?.userId || "",
            stripe_customer_id: subscription.customer as string,
            stripe_price_id: subscription.items.data[0]?.price.id as string,
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end as boolean,
            plan_id: getPlanIdFromPriceId(subscription.items.data[0]?.price.id as string),
          })
        } catch {
          // If update fails (no existing record), create
          await createSubscription({
            user_id: subscription.metadata?.userId || "",
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            stripe_price_id: subscription.items.data[0]?.price.id as string,
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end as boolean,
            plan_id: getPlanIdFromPriceId(subscription.items.data[0]?.price.id as string),
          })
        }

        // Trigger webhooks for this event
        const webhooks = await getWebhooksForEvent(
          "subscription.updated",
          subscription.metadata?.organizationId
        )
        for (const wh of webhooks) {
          const payload = JSON.stringify({ subscriptionId: subscription.id })
          const sig = generateSignature(payload, wh.secret)
          // Fire-and-forget webhook calls
          fetch(wh.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Signature": sig,
            },
            body: payload,
          }).catch(() => { })
        }
        break
      }

      case "customer.subscription.deleted": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any
        await updateSubscriptionByStripeSubId(subscription.id, {
          status: "canceled",
        })
        break
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        // Log but no action needed beyond webhook triggers
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Stripe webhook error:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 400 }
    )
  }
}

function getPlanIdFromPriceId(priceId: string): "free" | "pro" | "enterprise" {
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return "pro"
  if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE) return "enterprise"
  return "free"
}
