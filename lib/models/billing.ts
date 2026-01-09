import mongoose, { Schema } from "mongoose"

export interface ISubscription extends mongoose.Document {
  userId: string
  organizationId?: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripePriceId: string
  status: "active" | "canceled" | "past_due" | "trialing" | "incomplete"
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  planId: "free" | "pro" | "enterprise"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    stripeCustomerId: { type: String, required: true, unique: true, index: true },
    stripeSubscriptionId: { type: String, required: true, unique: true, index: true },
    stripePriceId: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "canceled", "past_due", "trialing", "incomplete"],
      required: true,
      index: true,
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    planId: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      required: true,
      index: true,
    },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
)

export const Subscription =
  mongoose.models.Subscription ||
  mongoose.model<ISubscription>("Subscription", SubscriptionSchema)

