import Stripe from "stripe"

// Lazy initialization to allow build without Stripe keys
let stripeInstance: Stripe | null = null

function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set")
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    })
  }
  return stripeInstance
}

// Export stripe as Proxy for backward compatibility
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe]
  },
})

// Subscription plans
export const PLANS = {
  free: {
    name: "Free",
    priceId: process.env.STRIPE_PRICE_ID_FREE || "",
    features: ["Basic features", "Limited usage"],
  },
  pro: {
    name: "Pro",
    priceId: process.env.STRIPE_PRICE_ID_PRO || "",
    features: ["All features", "Unlimited usage", "Priority support"],
  },
  enterprise: {
    name: "Enterprise",
    priceId: process.env.STRIPE_PRICE_ID_ENTERPRISE || "",
    features: ["All features", "Custom integrations", "Dedicated support"],
  },
} as const

export type PlanId = keyof typeof PLANS

// Create or update customer
export async function getOrCreateCustomer(
  userId: string,
  email: string,
  name?: string
): Promise<Stripe.Customer> {
  const stripe = getStripe()
  // Check if customer exists
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  })

  if (customers.data.length > 0) {
    const customer = customers.data[0]
    if (customer) {
      return customer
    }
  }

  // Create new customer
  return stripe.customers.create({
    email,
    name,
    metadata: {
      userId,
    },
  })
}

// Create checkout session
export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  organizationId?: string
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${process.env.BETTER_AUTH_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.BETTER_AUTH_URL}/billing`,
    metadata: {
      organizationId: organizationId || "",
    },
  })
}

// Create portal session
export async function createPortalSession(
  customerId: string
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe()
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.BETTER_AUTH_URL}/billing`,
  })
}

// Get subscription
export async function getSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    const stripe = getStripe()
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch (_error) {
    return null
  }
}

// Cancel subscription
export async function cancelSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.cancel(subscriptionId)
}

