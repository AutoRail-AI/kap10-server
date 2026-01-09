"use client"

import { Check } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { trackEvent } from "@/lib/analytics/client"

interface Plan {
  id: string
  name: string
  price: string
  features: string[]
  popular?: boolean
}

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    features: ["Basic features", "Limited usage", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    popular: true,
    features: ["All features", "Unlimited usage", "Priority support", "Advanced analytics"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    features: ["All features", "Custom integrations", "Dedicated support", "SLA guarantee"],
  },
]

export function SubscriptionCard({ currentPlan }: { currentPlan?: string }) {
  const [loading, setLoading] = useState<string | null>(null)

  const handleSubscribe = async (planId: string) => {
    setLoading(planId)
    trackEvent("subscription_checkout_started", { planId })

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      })

      const data = (await response.json()) as { url?: string }
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error("Checkout error:", error)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((plan) => (
        <Card key={plan.id} className={plan.popular ? "border-primary" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{plan.name}</CardTitle>
              {plan.popular && <Badge>Popular</Badge>}
            </div>
            <CardDescription>
              <span className="text-2xl font-bold">{plan.price}</span>
              {plan.price !== "Custom" && <span className="text-sm">/month</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 mb-4">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
            <Button
              className="w-full"
              variant={plan.popular ? "default" : "outline"}
              onClick={() => handleSubscribe(plan.id)}
              disabled={loading === plan.id || currentPlan === plan.id}
            >
              {loading === plan.id
                ? "Loading..."
                : currentPlan === plan.id
                  ? "Current Plan"
                  : plan.price === "Custom"
                    ? "Contact Sales"
                    : "Subscribe"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

