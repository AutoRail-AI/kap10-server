/**
 * Document types for the frontend
 * These mirror the database types but use string IDs instead of ObjectId
 */

export interface DocumentItem {
  id: string
  name: string
  version: string
  fileUrl: string
  fileType: "pdf" | "doc" | "docx" | "txt"
  fileSize: number
  status: "uploading" | "processing" | "ready" | "error"
  providerId?: string
  providerName?: string
  metadata: {
    pageCount?: number
    uploadedAt: Date
    processedAt?: Date
    chunkCount?: number
  }
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface DocumentListItem {
  id: string
  name: string
  version: string
  fileType: "pdf" | "doc" | "docx" | "txt"
  fileSize: number
  status: "uploading" | "processing" | "ready" | "error"
  providerName?: string
  isActive: boolean
  uploadedAt: Date
}

export interface DocumentUploadInput {
  name: string
  version?: string
  providerId?: string
  file: File
}

export interface DocumentVersion {
  id: string
  version: string
  uploadedAt: Date
  isActive: boolean
}

export type DocumentSortField = "name" | "uploadedAt" | "version"
export type DocumentSortOrder = "asc" | "desc"

export interface DocumentFilters {
  status?: "uploading" | "processing" | "ready" | "error"
  providerId?: string
  search?: string
}
