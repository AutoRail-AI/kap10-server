/**
 * Zod schemas for Phase 6 Pattern types.
 */
import { z } from "zod"

export const PatternTypeSchema = z.enum(["structural", "naming", "error-handling", "import", "testing", "custom"])
export const PatternStatusSchema = z.enum(["detected", "confirmed", "promoted", "rejected"])
export const PatternSourceSchema = z.enum(["ast-grep", "mined", "manual"])

export const PatternFilterSchema = z.object({
  type: PatternTypeSchema.optional(),
  status: PatternStatusSchema.optional(),
  source: PatternSourceSchema.optional(),
  language: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const UpdatePatternSchema = z.object({
  status: PatternStatusSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  type: PatternTypeSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const PromotePatternSchema = z.object({
  patternId: z.string().min(1),
  enforcement: z.enum(["suggest", "warn", "block"]).default("suggest"),
  scope: z.enum(["org", "repo", "path", "branch", "workspace"]).default("repo"),
  priority: z.number().int().min(0).max(100).default(50),
})

export type PatternFilterInput = z.infer<typeof PatternFilterSchema>
export type UpdatePatternInput = z.infer<typeof UpdatePatternSchema>
export type PromotePatternInput = z.infer<typeof PromotePatternSchema>
