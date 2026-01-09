// Mongoose models for application features
// Better Auth uses Prisma (see prisma/schema.prisma)

import mongoose, { Schema } from "mongoose"

// Example: Agent Conversation Model
export interface IAgentConversation extends mongoose.Document {
  userId: string
  organizationId?: string
  messages: Array<{
    role: "user" | "assistant" | "system"
    content: string
    timestamp: Date
  }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const AgentConversationSchema = new Schema<IAgentConversation>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    organizationId: {
      type: String,
      index: true,
    },
    messages: [
      {
        role: {
          type: String,
          enum: ["user", "assistant", "system"],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
)

export const AgentConversation =
  mongoose.models.AgentConversation ||
  mongoose.model<IAgentConversation>("AgentConversation", AgentConversationSchema)

// Add more Mongoose models here as needed
// Example: Projects, Documents, etc.

