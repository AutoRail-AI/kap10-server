import type { ObjectId } from "mongodb"

// User Types
export interface User {
  _id: ObjectId
  email: string
  name: string
  emailVerified: boolean
  tier: "free" | "premium" | "enterprise"
  createdAt: Date
  updatedAt: Date
  customSettings?: {
    letterhead?: Letterhead
    defaultProviders?: string[]
  }
  usage: {
    appealsGenerated: number
    lastAppealDate?: Date
    monthlyCount: number
    resetDate: Date
  }
}

export interface Letterhead {
  logo?: string
  logoKey?: string // uploadthing file key
  organizationName: string
  address?: string
  phone?: string
  email?: string
  fax?: string
  website?: string
}

// Provider Types
export interface Provider {
  _id: ObjectId
  name: string
  code: string
  category: "insurance" | "medicare" | "medicaid" | "other"
  isActive: boolean
  isDefault: boolean
  requirements: {
    appealDeadlineDays: number
    requiredFields: string[]
    preferredFormat: string
    submissionMethods: string[]
  }
  rulesetIds: ObjectId[]
  createdAt: Date
  updatedAt: Date
}

// Appeal Types
export interface Appeal {
  _id: ObjectId
  userId?: ObjectId
  sessionId: string
  originalInput: {
    patientInfo: string
    clinicalInfo: string
    denialReason: string
    additionalContext?: string
  }
  providerId: ObjectId
  rulesetId?: ObjectId
  generatedAppeal: {
    content: string
    letterheadApplied: boolean
    format: "text" | "pdf"
    url?: string
  }
  maskingLog: {
    itemsMasked: number
    maskingMethod: string
    timestamp: Date
  }
  status: "draft" | "generated" | "downloaded" | "submitted"
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}

// Conversation Types (Chat Interface)
export interface Conversation {
  _id: ObjectId
  userId?: ObjectId
  sessionId: string
  title: string
  provider?: ObjectId
  status: "active" | "archived"
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
}

// Message Types
export interface Message {
  _id: ObjectId
  conversationId: ObjectId
  role: "user" | "assistant" | "system"
  content: string
  metadata?: {
    masked?: boolean
    maskingStats?: MaskingStats
    appealGenerated?: boolean
    citations?: string[]
    attachments?: string[]
  }
  createdAt: Date
}

export interface MaskingStats {
  itemsMasked: number
  processingTimeMs: number
}

// Document Types
export interface Document {
  _id: ObjectId
  userId: ObjectId
  providerId?: ObjectId
  name: string
  version: string
  fileUrl: string
  fileKey: string // uploadthing file key
  fileType: "pdf" | "doc" | "docx" | "txt"
  fileSize: number
  status: "uploading" | "processing" | "ready" | "error"
  errorMessage?: string
  metadata: {
    pageCount?: number
    uploadedAt: Date
    processedAt?: Date
    chunkCount?: number
    originalFileName?: string
  }
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// RuleSet Types
export interface RuleSet {
  _id: ObjectId
  providerId: ObjectId
  name: string
  description: string
  version: string
  rules: {
    category: string
    criteria: RuleCriteria[]
    evidenceRequirements: string[]
    templateStructure: object
  }
  isDefault: boolean
  isCustom: boolean
  createdBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface RuleCriteria {
  requirement: string
  evidence: string[]
}
