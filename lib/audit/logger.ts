import { connectDB } from "@/lib/db/mongoose"
import mongoose, { Schema } from "mongoose"

export type AuditAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "login"
  | "logout"
  | "invite"
  | "subscribe"
  | "cancel"
  | "admin_action"

export interface IAuditLog extends mongoose.Document {
  userId?: string
  organizationId?: string
  action: AuditAction
  resource: string
  resourceId?: string
  metadata?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: String, index: true },
    organizationId: { type: String, index: true },
    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, index: true },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
)

// Index for common queries
AuditLogSchema.index({ userId: 1, createdAt: -1 })
AuditLogSchema.index({ organizationId: 1, createdAt: -1 })
AuditLogSchema.index({ action: 1, resource: 1, createdAt: -1 })

export const AuditLog =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema)

// Log an action
export async function logAction(
  action: AuditAction,
  resource: string,
  options: {
    userId?: string
    organizationId?: string
    resourceId?: string
    metadata?: Record<string, any>
    ipAddress?: string
    userAgent?: string
  }
): Promise<void> {
  await connectDB()

  await AuditLog.create({
    action,
    resource,
    userId: options.userId,
    organizationId: options.organizationId,
    resourceId: options.resourceId,
    metadata: options.metadata,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  })
}

// Get audit logs
export async function getAuditLogs(
  filters: {
    userId?: string
    organizationId?: string
    action?: AuditAction
    resource?: string
    startDate?: Date
    endDate?: Date
    limit?: number
  }
): Promise<IAuditLog[]> {
  await connectDB()

  const query: any = {}

  if (filters.userId) query.userId = filters.userId
  if (filters.organizationId) query.organizationId = filters.organizationId
  if (filters.action) query.action = filters.action
  if (filters.resource) query.resource = filters.resource

  if (filters.startDate || filters.endDate) {
    query.createdAt = {}
    if (filters.startDate) query.createdAt.$gte = filters.startDate
    if (filters.endDate) query.createdAt.$lte = filters.endDate
  }

  return AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(filters.limit || 100)
    .lean()
}

