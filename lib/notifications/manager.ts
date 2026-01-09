import mongoose, { Schema } from "mongoose"
import { connectDB } from "@/lib/db/mongoose"
import { queueEmail } from "@/lib/queue"

export type NotificationType =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "invitation"
  | "mention"
  | "system"

export interface INotification extends mongoose.Document {
  userId: string
  organizationId?: string
  type: NotificationType
  title: string
  message: string
  link?: string
  read: boolean
  readAt?: Date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  createdAt: Date
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    type: {
      type: String,
      enum: ["info", "success", "warning", "error", "invitation", "mention", "system"],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
)

// Indexes
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 })
NotificationSchema.index({ organizationId: 1, createdAt: -1 })

export const Notification =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema)

// Create notification
export async function createNotification(
  data: {
    userId: string
    organizationId?: string
    type: NotificationType
    title: string
    message: string
    link?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
    sendEmail?: boolean
  }
): Promise<INotification> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notification = await (Notification as any).create({
    userId: data.userId,
    organizationId: data.organizationId,
    type: data.type,
    title: data.title,
    message: data.message,
    link: data.link,
    metadata: data.metadata,
    read: false,
  })

  // Send email if requested
  if (data.sendEmail) {
    // Get user email from Better Auth
    const { prisma } = await import("@/lib/db/prisma")
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    })

    if (user?.email) {
      await queueEmail({
        to: user.email,
        subject: data.title,
        body: `
          <h2>${data.title}</h2>
          <p>${data.message}</p>
          ${data.link ? `<p><a href="${data.link}">View Details</a></p>` : ""}
        `,
      })
    }
  }

  return notification
}

// Get notifications
export async function getNotifications(
  userId: string,
  options: {
    unreadOnly?: boolean
    limit?: number
    organizationId?: string
  } = {}
): Promise<INotification[]> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { userId }
  if (options.unreadOnly) {
    query.read = false
  }
  if (options.organizationId) {
    query.organizationId = options.organizationId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Notification as any).find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
}

// Mark as read
export async function markAsRead(
  notificationId: string,
  userId: string
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Notification as any).findOneAndUpdate(
    { _id: notificationId, userId },
    { read: true, readAt: new Date() }
  )
}

// Mark all as read
export async function markAllAsRead(
  userId: string,
  organizationId?: string
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { userId, read: false }
  if (organizationId) {
    query.organizationId = organizationId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Notification as any).updateMany(query, {
    read: true,
    readAt: new Date(),
  })
}

// Get unread count
export async function getUnreadCount(
  userId: string,
  organizationId?: string
): Promise<number> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = { userId, read: false }
  if (organizationId) {
    query.organizationId = organizationId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Notification as any).countDocuments(query)
}

