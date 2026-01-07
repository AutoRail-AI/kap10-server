import { connectDB } from "@/lib/db/mongoose"
import mongoose, { Schema } from "mongoose"

export interface ISearchIndex extends mongoose.Document {
  organizationId?: string
  resource: string // e.g., "project", "document", "ai_agent"
  resourceId: string
  title: string
  content: string
  tags?: string[]
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const SearchIndexSchema = new Schema<ISearchIndex>(
  {
    organizationId: { type: String, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    tags: [{ type: String, index: true }],
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
)

// Text index for full-text search
SearchIndexSchema.index({
  title: "text",
  content: "text",
  tags: "text",
})

// Compound index
SearchIndexSchema.index({ organizationId: 1, resource: 1 })

export const SearchIndex =
  mongoose.models.SearchIndex ||
  mongoose.model<ISearchIndex>("SearchIndex", SearchIndexSchema)

// Index a document
export async function indexDocument(
  data: {
    organizationId?: string
    resource: string
    resourceId: string
    title: string
    content: string
    tags?: string[]
    metadata?: Record<string, any>
  }
): Promise<ISearchIndex> {
  await connectDB()

  return SearchIndex.findOneAndUpdate(
    {
      resource: data.resource,
      resourceId: data.resourceId,
    },
    {
      organizationId: data.organizationId,
      resource: data.resource,
      resourceId: data.resourceId,
      title: data.title,
      content: data.content,
      tags: data.tags,
      metadata: data.metadata,
    },
    { upsert: true, new: true }
  )
}

// Remove from index
export async function removeFromIndex(
  resource: string,
  resourceId: string
): Promise<void> {
  await connectDB()

  await SearchIndex.deleteOne({ resource, resourceId })
}

// Search
export async function search(
  query: string,
  options: {
    organizationId?: string
    resource?: string
    tags?: string[]
    limit?: number
  } = {}
): Promise<ISearchIndex[]> {
  await connectDB()

  const searchQuery: any = {
    $text: { $search: query },
  }

  if (options.organizationId) {
    searchQuery.organizationId = options.organizationId
  }
  if (options.resource) {
    searchQuery.resource = options.resource
  }
  if (options.tags && options.tags.length > 0) {
    searchQuery.tags = { $in: options.tags }
  }

  return SearchIndex.find(searchQuery, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } })
    .limit(options.limit || 20)
}

// Simple text search (fallback if text index not available)
export async function simpleSearch(
  query: string,
  options: {
    organizationId?: string
    resource?: string
    limit?: number
  } = {}
): Promise<ISearchIndex[]> {
  await connectDB()

  const searchQuery: any = {
    $or: [
      { title: { $regex: query, $options: "i" } },
      { content: { $regex: query, $options: "i" } },
    ],
  }

  if (options.organizationId) {
    searchQuery.organizationId = options.organizationId
  }
  if (options.resource) {
    searchQuery.resource = options.resource
  }

  return SearchIndex.find(searchQuery)
    .sort({ createdAt: -1 })
    .limit(options.limit || 20)
}

