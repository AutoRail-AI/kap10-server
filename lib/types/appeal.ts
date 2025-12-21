export interface AppealInput {
  patientInfo: string
  clinicalInfo: string
  denialReason: string
  additionalContext?: string
  providerId: string
  rulesetId?: string
}

export interface AppealOutput {
  success: boolean
  appealId: string
  content: string
  maskingStats: {
    itemsMasked: number
    processingTime: number
  }
  remaining?: number
}

export interface MaskingResult {
  masked: {
    patientInfo: string
    clinicalInfo: string
    denialReason: string
    additionalContext?: string
  }
  maskingLog: {
    itemsMasked: number
    maskingMethod: string
    processingTimeMs: number
    timestamp: Date
  }
}

export interface AppealGenerationOptions {
  tone?: "formal" | "professional" | "assertive"
  includeLetterhead?: boolean
  outputFormat?: "text" | "pdf"
  additionalInstructions?: string
}

export interface DenialInfo {
  code: string
  reason: string
  dateOfDenial: Date
  insurerName: string
  claimNumber?: string
}

export interface AppealResponse {
  id: string
  content: string
  citations: string[]
  createdAt: Date
  status: "draft" | "generated" | "downloaded"
}
