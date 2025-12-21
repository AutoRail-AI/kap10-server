// Frontend Letterhead Types

export interface LetterheadSettings {
  logo?: string
  logoKey?: string // uploadthing file key
  organizationName: string
  address?: string
  phone?: string
  email?: string
  fax?: string
  website?: string
}

export interface LetterheadFormData {
  organizationName: string
  address?: string
  phone?: string
  email?: string
  fax?: string
  website?: string
}

export interface LetterheadPreview {
  settings: LetterheadSettings
  sampleContent?: string
}
