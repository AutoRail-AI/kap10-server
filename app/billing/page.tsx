import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { SubscriptionCard } from "@/components/billing/subscription-card"
import { connectDB } from "@/lib/db/mongoose"
import { Subscription } from "@/lib/models/billing"

export default async function BillingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    redirect("/login")
  }

  await connectDB()

  // Get user's subscription
  const subscription = await Subscription.findOne({
    userId: session.user.id,
    status: "active",
  })

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing & Subscription</h1>
        <p className="text-muted-foreground">Manage your subscription and billing</p>
      </div>

      <SubscriptionCard currentPlan={subscription?.planId} />

      {subscription && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Current Subscription</h2>
          <div className="space-y-2">
            <p>
              <strong>Plan:</strong> {subscription.planId}
            </p>
            <p>
              <strong>Status:</strong> {subscription.status}
            </p>
            <p>
              <strong>Renews:</strong>{" "}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
            <form action="/api/billing/portal" method="POST">
              <button
                type="submit"
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded"
              >
                Manage Subscription
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

