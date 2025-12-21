// Brand Hierarchy: 10XR (parent company) → AppealGen AI (product)
export const COMPANY_NAME = "10XR"
export const COMPANY_URL = "https://10xr.co"
export const APP_NAME = "AppealGen AI"
export const APP_FULL_NAME = "AppealGen AI by 10XR"
export const APP_DESCRIPTION = "AI-Powered Medical Denial Appeal Generator"
export const APP_TAGLINE = "Generate citation-backed appeals in seconds, not hours"

export const TIERS = {
  FREE: "free",
  PREMIUM: "premium",
  ENTERPRISE: "enterprise",
} as const

export type Tier = (typeof TIERS)[keyof typeof TIERS]

export const TIER_LIMITS = {
  [TIERS.FREE]: {
    appealsPerMonth: 5,
    historyDays: 0,
    customLetterhead: false,
    customProviders: false,
  },
  [TIERS.PREMIUM]: {
    appealsPerMonth: 50,
    historyDays: 180,
    customLetterhead: true,
    customProviders: true,
  },
  [TIERS.ENTERPRISE]: {
    appealsPerMonth: Infinity,
    historyDays: Infinity,
    customLetterhead: true,
    customProviders: true,
  },
} as const

export const DEFAULT_PROVIDERS = [
  { code: "UHC", name: "UnitedHealthcare" },
  { code: "ANTHEM", name: "Anthem Blue Cross" },
  { code: "AETNA", name: "Aetna" },
  { code: "CIGNA", name: "Cigna" },
  { code: "HUMANA", name: "Humana" },
] as const

export const DENIAL_TYPES = {
  CO_50: { code: "CO-50", name: "Medical Necessity", phase: 1 },
  CO_11: { code: "CO-11", name: "Diagnosis Mismatch", phase: 2 },
  CO_197: { code: "CO-197", name: "Prior Authorization", phase: 2 },
  CO_97: { code: "CO-97", name: "Bundled Services", phase: 2 },
  CO_96: { code: "CO-96", name: "Non-Covered", phase: 3 },
} as const
