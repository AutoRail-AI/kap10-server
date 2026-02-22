/**
 * Zod schemas for Phase 6 Rule types.
 */
import { z } from "zod"

export const RuleScopeSchema = z.enum(["org", "repo", "path", "branch", "workspace"])
export const RuleEnforcementSchema = z.enum(["suggest", "warn", "block"])
export const RuleTypeSchema = z.enum(["architecture", "naming", "security", "performance", "style", "custom"])
export const RuleStatusSchema = z.enum(["active", "draft", "deprecated", "archived"])

export const CreateRuleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  type: RuleTypeSchema,
  scope: RuleScopeSchema,
  pathGlob: z.string().optional(),
  fileTypes: z.array(z.string()).optional(),
  entityKinds: z.array(z.string()).optional(),
  enforcement: RuleEnforcementSchema.default("suggest"),
  semgrepRule: z.string().optional(),
  astGrepQuery: z.string().optional(),
  astGrepFix: z.string().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  status: RuleStatusSchema.default("draft"),
  polyglot: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
})

export const UpdateRuleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  type: RuleTypeSchema.optional(),
  scope: RuleScopeSchema.optional(),
  pathGlob: z.string().optional(),
  fileTypes: z.array(z.string()).optional(),
  entityKinds: z.array(z.string()).optional(),
  enforcement: RuleEnforcementSchema.optional(),
  semgrepRule: z.string().optional(),
  astGrepQuery: z.string().optional(),
  astGrepFix: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  status: RuleStatusSchema.optional(),
  polyglot: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
})

export const RuleFilterSchema = z.object({
  scope: RuleScopeSchema.optional(),
  type: RuleTypeSchema.optional(),
  status: RuleStatusSchema.optional(),
  enforcement: RuleEnforcementSchema.optional(),
  language: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const CreateRuleExceptionSchema = z.object({
  ruleId: z.string().min(1),
  entityId: z.string().optional(),
  filePath: z.string().optional(),
  reason: z.string().min(1).max(1000),
  ttlDays: z.number().int().min(1).max(365).optional(),
})

export type CreateRuleInput = z.infer<typeof CreateRuleSchema>
export type UpdateRuleInput = z.infer<typeof UpdateRuleSchema>
export type RuleFilterInput = z.infer<typeof RuleFilterSchema>
export type CreateRuleExceptionInput = z.infer<typeof CreateRuleExceptionSchema>
