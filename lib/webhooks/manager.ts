import mongoose, { Schema } from "mongoose"
import crypto from "crypto"
import { connectDB } from "@/lib/db/mongoose"
import { queueWebhook } from "@/lib/queue"

export type WebhookEvent =
  | "user.created"
  | "user.updated"
  | "organization.created"
  | "organization.updated"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "payment.succeeded"
  | "payment.failed"

export interface IWebhook extends mongoose.Document {
  organizationId?: string
  url: string
  secret: string
  events: WebhookEvent[]
  enabled: boolean
  lastTriggeredAt?: Date
  failureCount: number
  createdAt: Date
  updatedAt: Date
}

const WebhookSchema = new Schema<IWebhook>(
  {
    organizationId: { type: String, index: true },
    url: { type: String, required: true },
    secret: { type: String, required: true },
    events: [{ type: String, required: true }],
    enabled: { type: Boolean, default: true },
    lastTriggeredAt: { type: Date },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const Webhook =
  mongoose.models.Webhook ||
  mongoose.model<IWebhook>("Webhook", WebhookSchema)

// Generate webhook secret
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex")
}

// Create webhook signature
export function createWebhookSignature(
  payload: string,
  secret: string
): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

// Verify webhook signature
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createWebhookSignature(payload, secret)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

// Trigger webhook
export async function triggerWebhook(
  event: WebhookEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
  organizationId?: string
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    enabled: true,
    events: event,
  }

  if (organizationId) {
    query.organizationId = organizationId
  } else {
    query.organizationId = { $exists: false } // Global webhooks
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhooks = await (Webhook as any).find(query)

  for (const webhook of webhooks) {
    const payloadData = {
      event,
      data,
      timestamp: new Date().toISOString(),
    }
    const payload = JSON.stringify(payloadData)

    const signature = createWebhookSignature(payload, webhook.secret)

    // Queue webhook delivery
    await queueWebhook({
      url: webhook.url,
      method: "POST",
      headers: {
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": event,
      },
      body: payloadData,
    })
  }
}

// Update webhook status
export async function updateWebhookStatus(
  webhookId: string,
  success: boolean
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    lastTriggeredAt: new Date(),
  }

  if (success) {
    update.failureCount = 0
  } else {
    update.$inc = { failureCount: 1 }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Webhook as any).findByIdAndUpdate(webhookId, update)
}

