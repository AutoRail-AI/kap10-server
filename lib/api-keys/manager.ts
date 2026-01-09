import mongoose, { Schema } from "mongoose"
import crypto from "crypto"
import { connectDB } from "@/lib/db/mongoose"

export interface IApiKey extends mongoose.Document {
  userId: string
  organizationId?: string
  name: string
  key: string // Hashed key
  keyPrefix: string // First 8 chars for display (e.g., "sk_live_ab")
  lastUsedAt?: Date
  expiresAt?: Date
  scopes: string[]
  rateLimit?: {
    requests: number
    windowMs: number
  }
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    name: { type: String, required: true },
    key: { type: String, required: true, unique: true, index: true },
    keyPrefix: { type: String, required: true },
    lastUsedAt: { type: Date },
    expiresAt: { type: Date },
    scopes: [{ type: String }],
    rateLimit: {
      requests: { type: Number },
      windowMs: { type: Number },
    },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const ApiKey =
  mongoose.models.ApiKey ||
  mongoose.model<IApiKey>("ApiKey", ApiKeySchema)

// Generate API key
export function generateApiKey(prefix: string = "sk_live"): string {
  const randomBytes = crypto.randomBytes(32)
  const key = randomBytes.toString("base64url")
  return `${prefix}_${key}`
}

// Hash API key for storage
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

// Verify API key
export async function verifyApiKey(
  key: string
): Promise<IApiKey | null> {
  await connectDB()

  const hashedKey = hashApiKey(key)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = await (ApiKey as any).findOne({ key: hashedKey, enabled: true })

  if (!apiKey) return null

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null
  }

  // Update last used
  apiKey.lastUsedAt = new Date()
  await apiKey.save()

  return apiKey
}

// Create API key
export async function createApiKey(
  userId: string,
  name: string,
  options: {
    organizationId?: string
    scopes?: string[]
    expiresAt?: Date
    rateLimit?: { requests: number; windowMs: number }
  }
): Promise<{ apiKey: IApiKey; plainKey: string }> {
  await connectDB()

  const plainKey = generateApiKey()
  const hashedKey = hashApiKey(plainKey)
  const keyPrefix = plainKey.substring(0, 12) // "sk_live_ab"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = await (ApiKey as any).create({
    userId,
    organizationId: options.organizationId,
    name,
    key: hashedKey,
    keyPrefix,
    scopes: options.scopes || ["read", "write"],
    expiresAt: options.expiresAt,
    rateLimit: options.rateLimit,
    enabled: true,
  })

  return { apiKey, plainKey }
}

// List API keys
export async function listApiKeys(
  userId: string,
  organizationId?: string
): Promise<IApiKey[]> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { userId }
  if (organizationId) {
    query.organizationId = organizationId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ApiKey as any).find(query).sort({ createdAt: -1 })
}

// Revoke API key
export async function revokeApiKey(
  keyId: string,
  userId: string
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ApiKey as any).findOneAndUpdate(
    { _id: keyId, userId },
    { enabled: false }
  )
}

