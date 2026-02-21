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
  progress?: number
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

// Phase 2: MCP types

export interface ProjectStats {
  files: number
  functions: number
  classes: number
  interfaces: number
  variables: number
  languages: Record<string, number>
}

export interface SearchResult {
  name: string
  kind: string
  file_path: string
  line: number
  signature?: string
  score: number
}

export interface ImportChain {
  path: string
  entities: EntityDoc[]
  distance: number
}

// Phase 4: Business Justification types

export interface JustificationDoc {
  id: string
  org_id: string
  repo_id: string
  entity_id: string
  taxonomy: "VERTICAL" | "HORIZONTAL" | "UTILITY"
  confidence: number
  business_purpose: string
  domain_concepts: string[]
  feature_tag: string
  semantic_triples: Array<{ subject: string; predicate: string; object: string }>
  compliance_tags: string[]
  model_tier: "heuristic" | "fast" | "standard" | "premium"
  model_used?: string
  valid_from: string
  valid_to: string | null
  created_at: string
}

export interface FeatureAggregation {
  id: string
  org_id: string
  repo_id: string
  feature_tag: string
  entity_count: number
  entry_points: string[]
  hot_paths: string[][]
  taxonomy_breakdown: Record<string, number>
  average_confidence: number
  created_at: string
}

export interface HealthReportDoc {
  id: string
  org_id: string
  repo_id: string
  total_entities: number
  justified_entities: number
  average_confidence: number
  taxonomy_breakdown: Record<string, number>
  risks: Array<{
    riskType: string
    entityId?: string
    featureTag?: string
    description: string
    severity: "low" | "medium" | "high"
  }>
  generated_at: string
}

export interface DomainOntologyDoc {
  id: string
  org_id: string
  repo_id: string
  terms: Array<{ term: string; frequency: number; relatedTerms: string[] }>
  ubiquitous_language: Record<string, string>
  generated_at: string
}

export interface DriftScoreDoc {
  id: string
  org_id: string
  repo_id: string
  entity_id: string
  ast_hash_old: string
  ast_hash_new: string
  embedding_similarity: number
  category: "stable" | "cosmetic" | "refactor" | "intent_drift"
  detected_at: string
}

export interface ADRDoc {
  id: string
  org_id: string
  repo_id: string
  feature_area: string
  title: string
  context: string
  decision: string
  consequences: string
  generated_at: string
}

export interface SubgraphResult {
  entities: EntityDoc[]
  edges: EdgeDoc[]
}

// Phase 4: Token usage tracking
export interface TokenUsageEntry {
  id: string
  org_id: string
  repo_id: string
  model: string
  input_tokens: number
  output_tokens: number
  activity: string
  created_at: string
}

export interface TokenUsageSummary {
  total_input_tokens: number
  total_output_tokens: number
  estimated_cost_usd: number
  by_model: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }>
}

// Phase 5: Incremental Indexing types

export interface ChangedFile {
  path: string
  changeType: "added" | "modified" | "removed"
}

export interface EntityDiff {
  added: EntityDoc[]
  updated: EntityDoc[]
  deleted: EntityDoc[]
}

export interface IndexEventDoc {
  org_id: string
  repo_id: string
  push_sha: string
  commit_message: string
  event_type: "incremental" | "full_reindex" | "force_push_reindex"
  files_changed: number
  entities_added: number
  entities_updated: number
  entities_deleted: number
  edges_repaired: number
  embeddings_updated: number
  cascade_status: "none" | "pending" | "running" | "complete" | "skipped"
  cascade_entities: number
  duration_ms: number
  workflow_id: string
  extraction_errors?: Array<{ filePath: string; reason: string; quarantined: boolean }>
  created_at: string
}

export interface DriftAlert {
  entityKey: string
  entityName: string
  oldPurpose: string
  newPurpose: string
  affectedCallers: Array<{ name: string; filePath: string; author?: string }>
  channel: "dashboard" | "github_issue" | "both"
}

export interface PushSignalPayload {
  afterSha: string
  beforeSha: string
  ref: string
  commitMessage?: string
}

// Phase 5.5: Prompt Ledger & Rewind types

export type LedgerEntryStatus = "pending" | "working" | "broken" | "committed" | "reverted"

/** Valid state transitions for the ledger entry state machine. */
export const VALID_LEDGER_TRANSITIONS: Record<LedgerEntryStatus, LedgerEntryStatus[]> = {
  pending: ["working", "broken", "committed", "reverted"],
  working: ["broken", "committed", "reverted"],
  broken: ["working", "reverted"],
  committed: [],
  reverted: [],
}

export function validateLedgerTransition(
  from: LedgerEntryStatus,
  to: LedgerEntryStatus
): boolean {
  return VALID_LEDGER_TRANSITIONS[from].includes(to)
}

export interface LedgerEntry {
  id: string
  org_id: string
  repo_id: string
  user_id: string
  branch: string
  timeline_branch: number
  prompt: string
  agent_model?: string
  agent_tool?: string
  mcp_tools_called?: string[]
  changes: LedgerChange[]
  status: LedgerEntryStatus
  parent_id: string | null
  rewind_target_id: string | null
  commit_sha: string | null
  snapshot_id: string | null
  validated_at: string | null
  rule_generated: string | null
  blast_radius?: { safeFiles: string[]; conflictedFiles: string[] }
  created_at: string
}

export interface LedgerChange {
  file_path: string
  entity_id?: string
  change_type: "added" | "modified" | "deleted"
  diff: string
  lines_added: number
  lines_removed: number
}

export interface WorkingSnapshot {
  id: string
  org_id: string
  repo_id: string
  user_id: string
  branch: string
  timeline_branch: number
  ledger_entry_id: string
  reason: "tests_passed" | "user_marked" | "commit" | "session_start"
  files: SnapshotFile[]
  created_at: string
}

export interface SnapshotFile {
  file_path: string
  content: string
  entity_hashes: string[]
}

export interface LedgerSummary {
  id: string
  commit_sha: string
  org_id: string
  repo_id: string
  user_id: string
  branch: string
  entry_count: number
  prompt_summary: string
  total_files_changed: number
  total_lines_added: number
  total_lines_removed: number
  rewind_count: number
  rules_generated: string[]
  created_at: string
}

export interface SimulateRewindResult {
  safeFiles: string[]
  conflictedFiles: Array<{ filePath: string; lineRanges: string[] }>
  manualChangesAtRisk: Array<{ filePath: string; lineRanges: string[] }>
}

/** Ledger timeline query options */
export interface LedgerTimelineQuery {
  orgId: string
  repoId: string
  branch?: string
  timelineBranch?: number
  status?: LedgerEntryStatus
  limit?: number
  cursor?: string
  userId?: string
}

/** Paginated result for ledger timeline */
export interface PaginatedResult<T> {
  items: T[]
  cursor: string | null
  hasMore: boolean
}
