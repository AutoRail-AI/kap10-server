import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/billing/stripe"
import { connectDB } from "@/lib/db/mongoose"
import type { ISubscription } from "@/lib/models/billing"
import { triggerWebhook } from "@/lib/webhooks/manager"

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

    await connectDB()

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any
        const { Subscription } = await import("@/lib/models/billing")
        const updateData: Partial<ISubscription> = {
          userId: subscription.metadata?.userId || "",
          stripeCustomerId: subscription.customer as string,
          stripePriceId: subscription.items.data[0]?.price.id as string,
          status: subscription.status as ISubscription["status"],
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end as boolean,
          planId: getPlanIdFromPriceId(subscription.items.data[0]?.price.id as string),
        }
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (Subscription as any).findOneAndUpdate(
          { stripeSubscriptionId: subscription.id },
          updateData,
          { upsert: true, new: true }
        )

        await triggerWebhook(
          "subscription.updated",
          { subscriptionId: subscription.id },
          subscription.metadata?.organizationId
        )
        break
      }

      case "customer.subscription.deleted": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any
        const { Subscription } = await import("@/lib/models/billing")
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (Subscription as any).findOneAndUpdate(
          { stripeSubscriptionId: subscription.id },
          { status: "canceled" }
        )

        await triggerWebhook(
          "subscription.cancelled",
          { subscriptionId: subscription.id },
          subscription.metadata?.organizationId
        )
        break
      }

      case "invoice.payment_succeeded": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any

        await triggerWebhook(
          "payment.succeeded",
          { invoiceId: invoice.id, amount: invoice.amount_paid },
          invoice.metadata?.organizationId
        )
        break
      }

      case "invoice.payment_failed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any

        await triggerWebhook(
          "payment.failed",
          { invoiceId: invoice.id, amount: invoice.amount_due },
          invoice.metadata?.organizationId
        )
        break
      }
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

