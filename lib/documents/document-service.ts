import { ObjectId } from "mongodb"
import { getCollection } from "@/lib/db"
import type { Document, Provider } from "@/lib/types/database"
import type { DocumentItem, DocumentListItem } from "@/lib/types/document"

/**
 * Create a new document record
 */
export async function createDocument(params: {
  userId: string
  name: string
  version: string
  fileUrl: string
  fileKey: string
  fileType: "pdf" | "doc" | "docx" | "txt"
  fileSize: number
  providerId?: string
  originalFileName?: string
}): Promise<DocumentItem> {
  const documents = await getCollection<Document>("documents")

  const now = new Date()
  const doc: Omit<Document, "_id"> = {
    userId: new ObjectId(params.userId),
    providerId: params.providerId ? new ObjectId(params.providerId) : undefined,
    name: params.name,
    version: params.version || "1.0",
    fileUrl: params.fileUrl,
    fileKey: params.fileKey,
    fileType: params.fileType,
    fileSize: params.fileSize,
    status: "processing",
    metadata: {
      uploadedAt: now,
      originalFileName: params.originalFileName,
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }

  const result = await documents.insertOne(doc as Document)

  return {
    id: result.insertedId.toString(),
    name: doc.name,
    version: doc.version,
    fileUrl: doc.fileUrl,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    providerId: doc.providerId?.toString(),
    metadata: {
      uploadedAt: doc.metadata.uploadedAt,
    },
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/**
 * Get list of documents for a user
 */
export async function getDocumentList(params: {
  userId: string
  status?: Document["status"]
  providerId?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<DocumentListItem[]> {
  const documents = await getCollection<Document>("documents")
  const providers = await getCollection<Provider>("providers")

  // Build query
  const query: Record<string, unknown> = {
    userId: new ObjectId(params.userId),
  }

  if (params.status) {
    query.status = params.status
  }

  if (params.providerId) {
    query.providerId = new ObjectId(params.providerId)
  }

  if (params.search) {
    query.name = { $regex: params.search, $options: "i" }
  }

  const docs = await documents
    .find(query)
    .sort({ createdAt: -1 })
    .skip(params.offset || 0)
    .limit(params.limit || 50)
    .toArray()

  // Get provider names
  const providerIds = docs
    .map((d) => d.providerId)
    .filter((id): id is ObjectId => !!id)

  const providerDocs =
    providerIds.length > 0
      ? await providers.find({ _id: { $in: providerIds } }).toArray()
      : []

  const providerMap = new Map(
    providerDocs.map((p) => [p._id.toString(), p.name])
  )

  return docs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    version: doc.version,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    providerName: doc.providerId
      ? providerMap.get(doc.providerId.toString())
      : undefined,
    isActive: doc.isActive,
    uploadedAt: doc.metadata.uploadedAt,
  }))
}

/**
 * Get a single document by ID
 */
export async function getDocument(params: {
  id: string
  userId: string
}): Promise<DocumentItem | null> {
  const documents = await getCollection<Document>("documents")
  const providers = await getCollection<Provider>("providers")

  const doc = await documents.findOne({
    _id: new ObjectId(params.id),
    userId: new ObjectId(params.userId),
  })

  if (!doc) {
    return null
  }

  let providerName: string | undefined
  if (doc.providerId) {
    const provider = await providers.findOne({ _id: doc.providerId })
    providerName = provider?.name
  }

  return {
    id: doc._id.toString(),
    name: doc.name,
    version: doc.version,
    fileUrl: doc.fileUrl,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    providerId: doc.providerId?.toString(),
    providerName,
    metadata: {
      pageCount: doc.metadata.pageCount,
      uploadedAt: doc.metadata.uploadedAt,
      processedAt: doc.metadata.processedAt,
      chunkCount: doc.metadata.chunkCount,
    },
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/**
 * Update document status
 */
export async function updateDocumentStatus(params: {
  id: string
  userId: string
  status: Document["status"]
  errorMessage?: string
  metadata?: Partial<Document["metadata"]>
}): Promise<boolean> {
  const documents = await getCollection<Document>("documents")

  const updateData: Record<string, unknown> = {
    status: params.status,
    updatedAt: new Date(),
  }

  if (params.errorMessage) {
    updateData.errorMessage = params.errorMessage
  }

  if (params.metadata) {
    Object.entries(params.metadata).forEach(([key, value]) => {
      updateData[`metadata.${key}`] = value
    })
  }

  const result = await documents.updateOne(
    {
      _id: new ObjectId(params.id),
      userId: new ObjectId(params.userId),
    },
    { $set: updateData }
  )

  return result.modifiedCount > 0
}

/**
 * Update document details
 */
export async function updateDocument(params: {
  id: string
  userId: string
  name?: string
  version?: string
  providerId?: string | null
  isActive?: boolean
}): Promise<boolean> {
  const documents = await getCollection<Document>("documents")

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (params.name !== undefined) {
    updateData.name = params.name
  }

  if (params.version !== undefined) {
    updateData.version = params.version
  }

  if (params.providerId !== undefined) {
    updateData.providerId = params.providerId
      ? new ObjectId(params.providerId)
      : null
  }

  if (params.isActive !== undefined) {
    updateData.isActive = params.isActive
  }

  const result = await documents.updateOne(
    {
      _id: new ObjectId(params.id),
      userId: new ObjectId(params.userId),
    },
    { $set: updateData }
  )

  return result.modifiedCount > 0
}

/**
 * Delete a document
 */
export async function deleteDocument(params: {
  id: string
  userId: string
}): Promise<{ success: boolean; fileKey?: string }> {
  const documents = await getCollection<Document>("documents")

  // First get the document to return the fileKey for cleanup
  const doc = await documents.findOne({
    _id: new ObjectId(params.id),
    userId: new ObjectId(params.userId),
  })

  if (!doc) {
    return { success: false }
  }

  const result = await documents.deleteOne({
    _id: new ObjectId(params.id),
    userId: new ObjectId(params.userId),
  })

  return {
    success: result.deletedCount > 0,
    fileKey: doc.fileKey,
  }
}

/**
 * Get document versions (documents with same name)
 */
export async function getDocumentVersions(params: {
  userId: string
  name: string
}): Promise<Array<{ id: string; version: string; uploadedAt: Date; isActive: boolean }>> {
  const documents = await getCollection<Document>("documents")

  const docs = await documents
    .find({
      userId: new ObjectId(params.userId),
      name: params.name,
    })
    .sort({ createdAt: -1 })
    .toArray()

  return docs.map((doc) => ({
    id: doc._id.toString(),
    version: doc.version,
    uploadedAt: doc.metadata.uploadedAt,
    isActive: doc.isActive,
  }))
}

/**
 * Set a document version as active (deactivates others with same name)
 */
export async function setActiveVersion(params: {
  id: string
  userId: string
}): Promise<boolean> {
  const documents = await getCollection<Document>("documents")

  // Get the document
  const doc = await documents.findOne({
    _id: new ObjectId(params.id),
    userId: new ObjectId(params.userId),
  })

  if (!doc) {
    return false
  }

  // Deactivate all versions with the same name
  await documents.updateMany(
    {
      userId: new ObjectId(params.userId),
      name: doc.name,
    },
    { $set: { isActive: false, updatedAt: new Date() } }
  )

  // Activate the specified version
  const result = await documents.updateOne(
    { _id: new ObjectId(params.id) },
    { $set: { isActive: true, updatedAt: new Date() } }
  )

  return result.modifiedCount > 0
}
