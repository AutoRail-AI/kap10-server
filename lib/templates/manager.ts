import mongoose, { Schema } from "mongoose"
import { connectDB } from "@/lib/db/mongoose"

export type TemplateType = "prompt" | "workflow" | "agent" | "form"

export interface ITemplate extends mongoose.Document {
  userId?: string
  organizationId?: string
  name: string
  description?: string
  type: TemplateType
  category?: string
  tags?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Record<string, any> // Template content (varies by type)
  variables?: Array<{
    name: string
    description: string
    required: boolean
    default?: string
  }>
  public: boolean
  featured: boolean
  usageCount: number
  createdAt: Date
  updatedAt: Date
}

const TemplateSchema = new Schema<ITemplate>(
  {
    userId: { type: String, index: true },
    organizationId: { type: String, index: true },
    name: { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: ["prompt", "workflow", "agent", "form"],
      required: true,
      index: true,
    },
    category: { type: String, index: true },
    tags: [{ type: String }],
    content: { type: Schema.Types.Mixed, required: true },
    variables: [
      {
        name: String,
        description: String,
        required: Boolean,
        default: String,
      },
    ],
    public: { type: Boolean, default: false, index: true },
    featured: { type: Boolean, default: false, index: true },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

// Indexes
TemplateSchema.index({ type: 1, public: 1, featured: 1 })
TemplateSchema.index({ organizationId: 1, type: 1 })
TemplateSchema.index({ tags: 1 })

export const Template =
  mongoose.models.Template ||
  mongoose.model<ITemplate>("Template", TemplateSchema)

// Create template
export async function createTemplate(
  data: {
    userId?: string
    organizationId?: string
    name: string
    description?: string
    type: TemplateType
    category?: string
    tags?: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: Record<string, any>
    variables?: Array<{
      name: string
      description: string
      required: boolean
      default?: string
    }>
    public?: boolean
  }
): Promise<ITemplate> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Template as any).create({
    userId: data.userId,
    organizationId: data.organizationId,
    name: data.name,
    description: data.description,
    type: data.type,
    category: data.category,
    tags: data.tags,
    content: data.content,
    variables: data.variables,
    public: data.public || false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    featured: false as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usageCount: 0 as any,
  })
}

// Get templates
export async function getTemplates(
  options: {
    userId?: string
    organizationId?: string
    type?: TemplateType
    category?: string
    tags?: string[]
    publicOnly?: boolean
    featured?: boolean
    limit?: number
  } = {}
): Promise<ITemplate[]> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {}

  if (options.publicOnly) {
    query.public = true
  } else if (options.userId) {
    query.$or = [
      { userId: options.userId },
      { organizationId: options.organizationId },
      { public: true },
    ]
  } else if (options.organizationId) {
    query.$or = [{ organizationId: options.organizationId }, { public: true }]
  } else {
    query.public = true
  }

  if (options.type) query.type = options.type
  if (options.category) query.category = options.category
  if (options.tags && options.tags.length > 0) {
    query.tags = { $in: options.tags }
  }
  if (options.featured !== undefined) query.featured = options.featured

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Template as any).find(query)
    .sort({ featured: -1, usageCount: -1, createdAt: -1 })
    .limit(options.limit || 50)
}

// Use template (increment usage count)
export async function useTemplate(templateId: string): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Template as any).findByIdAndUpdate(templateId, {
    $inc: { usageCount: 1 },
  })
}

// Get template by ID
export async function getTemplate(templateId: string): Promise<ITemplate | null> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Template as any).findById(templateId)
}

