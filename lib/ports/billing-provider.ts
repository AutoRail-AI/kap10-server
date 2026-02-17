export interface Subscription {
  id: string
  status: string
  [key: string]: unknown
}

export interface IBillingProvider {
  createCheckoutSession(orgId: string, planId: string): Promise<{ url: string }>
  createSubscription(orgId: string, planId: string): Promise<Subscription>
  cancelSubscription(subscriptionId: string): Promise<void>
  reportUsage(orgId: string, amount: number, description: string): Promise<void>
  createOnDemandCharge(orgId: string, amountUsd: number): Promise<{ url: string }>
}
