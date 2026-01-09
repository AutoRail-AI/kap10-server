import mongoose, { Schema } from "mongoose"
import { connectDB } from "@/lib/db/mongoose"

export type ActivityType =
  | "user.created"
  | "user.updated"
  | "organization.created"
  | "organization.updated"
  | "member.invited"
  | "member.joined"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "ai_agent.run"
  | "document.created"
  | "document.updated"
  | "comment.created"
  | "subscription.created"
  | "subscription.updated"

export interface IActivity extends mongoose.Document {
  userId?: string
  organizationId?: string
  type: ActivityType
  action: string // Human-readable action
  resource: string // Resource type
  resourceId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  createdAt: Date
}

const ActivitySchema = new Schema<IActivity>(
  {
    userId: { type: String, index: true },
    organizationId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    resourceId: { type: String, index: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
)

// Indexes for efficient queries
ActivitySchema.index({ organizationId: 1, createdAt: -1 })
ActivitySchema.index({ userId: 1, createdAt: -1 })
ActivitySchema.index({ resource: 1, resourceId: 1 })

export const Activity =
  mongoose.models.Activity ||
  mongoose.model<IActivity>("Activity", ActivitySchema)

// Create activity
export async function createActivity(
  data: {
    userId?: string
    organizationId: string
    type: ActivityType
    action: string
    resource: string
    resourceId?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
  }
): Promise<IActivity> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Activity as any).create({
    userId: data.userId,
    organizationId: data.organizationId,
    type: data.type,
    action: data.action,
    resource: data.resource,
    resourceId: data.resourceId,
    metadata: data.metadata,
  })
}

// Get activity feed
export async function getActivityFeed(
  organizationId: string,
  options: {
    userId?: string
    resource?: string
    resourceId?: string
    limit?: number
    before?: Date
  } = {}
): Promise<IActivity[]> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { organizationId }
  if (options.userId) {
    query.userId = options.userId
  }
  if (options.resource) {
    query.resource = options.resource
  }
  if (options.resourceId) {
    query.resourceId = options.resourceId
  }
  if (options.before) {
    query.createdAt = { $lt: options.before }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Activity as any).find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
}

// Get user activity
export async function getUserActivity(
  userId: string,
  options: {
    organizationId?: string
    limit?: number
  } = {}
): Promise<IActivity[]> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { userId }
  if (options.organizationId) {
    query.organizationId = options.organizationId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Activity as any).find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
}

