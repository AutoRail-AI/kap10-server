/**
 * Stub IBillingProvider (Phase 0). Phase 2+ will implement with Stripe.
 */

import type { IBillingProvider } from "@/lib/ports/billing-provider"
import { NotImplementedError } from "./errors"

export class StripePayments implements IBillingProvider {
  async createCheckoutSession(): Promise<{ url: string }> {
    throw new NotImplementedError("IBillingProvider.createCheckoutSession not implemented in Phase 0")
  }

  async createSubscription(): Promise<never> {
    throw new NotImplementedError("IBillingProvider.createSubscription not implemented in Phase 0")
  }

  async cancelSubscription(): Promise<void> {
    throw new NotImplementedError("IBillingProvider.cancelSubscription not implemented in Phase 0")
  }

  async reportUsage(): Promise<void> {
    throw new NotImplementedError("IBillingProvider.reportUsage not implemented in Phase 0")
  }
}
