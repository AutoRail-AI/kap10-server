/**
 * Domain types shared across all ports (Phase 0).
 * No external dependencies — used by port interfaces and adapters.
 */

export interface EntityDoc {
  id: string
  org_id: string
  repo_id: string
  kind: string
  name: string
  file_path: string
  [key: string]: unknown
}

export interface EdgeDoc {
  _from: string
  _to: string
  org_id: string
  repo_id: string
  kind: string
  [key: string]: unknown
}

export interface RuleDoc {
  id: string
  org_id: string
  name: string
  [key: string]: unknown
}

export interface PatternDoc {
  id: string
  org_id: string
  name: string
  [key: string]: unknown
}

export interface SnippetDoc {
  id: string
  org_id: string
  repo_id: string
  [key: string]: unknown
}

export interface FeatureDoc {
  id: string
  org_id: string
  repo_id: string
  [key: string]: unknown
}

export interface BlueprintData {
  features: FeatureDoc[]
  [key: string]: unknown
}

export interface OrgContext {
  orgId: string
  repoId?: string
  userId: string
  sessionId?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface WorkflowHandle<T = unknown> {
  workflowId: string
  runId: string
  result: () => Promise<T>
}

export interface WorkflowStatus {
  workflowId: string
  status: string
  [key: string]: unknown
}

export interface ImpactResult {
  entityId: string
  affected: EntityDoc[]
  [key: string]: unknown
}

export interface RuleFilter {
  orgId: string
  [key: string]: unknown
}

export interface PatternFilter {
  orgId: string
  [key: string]: unknown
}

export interface SnippetFilter {
  orgId: string
  repoId?: string
  [key: string]: unknown
}
