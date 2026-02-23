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
  index_version?: string
  [key: string]: unknown
}

export interface EdgeDoc {
  _from: string
  _to: string
  org_id: string
  repo_id: string
  kind: string
  index_version?: string
  [key: string]: unknown
}

// Phase 6: Rule scope and enforcement levels
export type RuleScope = "org" | "repo" | "path" | "branch" | "workspace"
export type RuleEnforcement = "suggest" | "warn" | "block"
export type RuleType = "architecture" | "naming" | "security" | "performance" | "style" | "custom"
export type RuleStatus = "active" | "draft" | "deprecated" | "archived"

export interface RuleDoc {
  id: string
  org_id: string
  repo_id?: string
  name: string
  title: string
  description: string
  type: RuleType
  scope: RuleScope
  pathGlob?: string
  fileTypes?: string[]
  entityKinds?: string[]
  enforcement: RuleEnforcement
  semgrepRule?: string
  astGrepQuery?: string
  astGrepFix?: string
  priority: number
  status: RuleStatus
  polyglot?: boolean
  languages?: string[]
  createdBy?: string
  created_at: string
  updated_at: string
}

// Phase 6: Pattern types
export type PatternType = "structural" | "naming" | "error-handling" | "import" | "testing" | "custom"
export type PatternStatus = "detected" | "confirmed" | "promoted" | "rejected"
export type PatternSource = "ast-grep" | "mined" | "manual"

export interface PatternDoc {
  id: string
  org_id: string
  repo_id: string
  name: string
  type: PatternType
  title: string
  astGrepQuery?: string
  evidence: Array<{ file: string; line: number; snippet?: string }>
  adherenceRate: number
  confidence: number
  status: PatternStatus
  source: PatternSource
  language?: string
  created_at: string
  updated_at: string
}

// Phase 6: Rule Health tracking
export interface RuleHealthDoc {
  id: string
  org_id: string
  rule_id: string
  triggered_count: number
  overridden_count: number
  false_positive_count: number
  auto_fixed_count: number
  last_triggered_at: string | null
  decay_score: number
  updated_at: string
}

// Phase 6: Mined Pattern (from community detection)
export interface MinedPatternDoc {
  id: string
  org_id: string
  repo_id: string
  community_id: number
  motif_hash: string
  entity_keys: string[]
  edge_count: number
  label: string
  confidence: number
  status: "pending" | "validated" | "rejected"
  created_at: string
}

// Phase 6: Impact Report (blast radius simulation)
export interface ImpactReportDoc {
  id: string
  org_id: string
  repo_id: string
  rule_id: string
  total_files_scanned: number
  total_violations: number
  violations_by_severity: Record<string, number>
  affected_files: Array<{ file: string; violations: number }>
  estimated_fix_effort: "low" | "medium" | "high"
  generated_at: string
}

// Phase 6: Rule Exception (time-bound exemptions)
export interface RuleExceptionDoc {
  id: string
  org_id: string
  rule_id: string
  entity_id?: string
  file_path?: string
  reason: string
  created_by: string
  expires_at: string
  status: "active" | "expired" | "revoked"
  created_at: string
}

// Phase 6: ast-grep types
export interface AstGrepResult {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
  matchedCode: string
  ruleId?: string
  message?: string
  fix?: string
}

export interface AstGrepQuery {
  id: string
  pattern: string
  language: string
  message?: string
  fix?: string
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
  repoId?: string
  scope?: RuleScope
  type?: RuleType
  status?: RuleStatus
  enforcement?: RuleEnforcement
  language?: string
  pathGlob?: string
  limit?: number
}

export interface PatternFilter {
  orgId: string
  repoId?: string
  type?: PatternType
  status?: PatternStatus
  source?: PatternSource
  language?: string
  minConfidence?: number
  limit?: number
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
  architectural_pattern?: string
  model_tier: "heuristic" | "fast" | "standard" | "premium"
  model_used?: string
  valid_from: string
  valid_to: string | null
  created_at: string
  /** Extensible metadata: body_hash, quality_score, quality_flags, propagated_* fields */
  [key: string]: unknown
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
    category?: "dead_code" | "architecture" | "quality" | "complexity" | "taxonomy"
    affectedCount?: number
    entities?: Array<{ id: string; name: string; filePath: string; detail?: string }>
  }>
  generated_at: string
}

export interface DomainOntologyDoc {
  id: string
  org_id: string
  repo_id: string
  terms: Array<{ term: string; frequency: number; relatedTerms: string[] }>
  ubiquitous_language: Record<string, string>
  /** Project name extracted from package.json / pyproject.toml / go.mod */
  project_name?: string
  /** Project description from manifest */
  project_description?: string
  /** Inferred domain (e.g., "developer tools", "e-commerce") */
  project_domain?: string
  /** Detected tech stack (e.g., ["Next.js", "PostgreSQL", "Redis"]) */
  tech_stack?: string[]
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

// Phase 7: PR Review Integration types

export type PrReviewStatus = "pending" | "reviewing" | "completed" | "failed"

export interface PrReviewRecord {
  id: string
  repoId: string
  prNumber: number
  prTitle: string
  prUrl: string
  headSha: string
  baseSha: string
  status: PrReviewStatus
  checksPassed: number
  checksWarned: number
  checksFailed: number
  reviewBody: string | null
  githubReviewId: number | null
  githubCheckRunId: number | null
  autoApproved: boolean
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface PrReviewCommentRecord {
  id: string
  reviewId: string
  filePath: string
  lineNumber: number
  checkType: "pattern" | "impact" | "test" | "complexity" | "dependency" | "trustBoundary" | "idempotency" | "env" | "contract"
  severity: "info" | "warning" | "error"
  message: string
  suggestion: string | null
  semgrepRuleId: string | null
  ruleTitle: string | null
  githubCommentId: number | null
  autoFix: string | null
  createdAt: string
}

export interface ReviewConfig {
  enabled: boolean
  autoApproveOnClean: boolean
  targetBranches: string[]
  skipDraftPrs: boolean
  impactThreshold: number
  complexityThreshold: number
  checksEnabled: {
    pattern: boolean
    impact: boolean
    test: boolean
    complexity: boolean
    dependency: boolean
    trustBoundary: boolean
    idempotency: boolean
    env: boolean
    contract: boolean
  }
  ignorePaths: string[]
  semanticLgtmEnabled: boolean
  horizontalAreas: string[]
  lowRiskCallerThreshold: number
  nudgeEnabled: boolean
  nudgeDelayHours: number
}

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  enabled: true,
  autoApproveOnClean: false,
  targetBranches: ["main"],
  skipDraftPrs: true,
  impactThreshold: 15,
  complexityThreshold: 10,
  checksEnabled: {
    pattern: true,
    impact: true,
    test: true,
    complexity: true,
    dependency: true,
    trustBoundary: true,
    idempotency: true,
    env: true,
    contract: true,
  },
  ignorePaths: [],
  semanticLgtmEnabled: false,
  horizontalAreas: ["utility", "infrastructure", "config", "docs", "test", "ci"],
  lowRiskCallerThreshold: 5,
  nudgeEnabled: true,
  nudgeDelayHours: 48,
}

export interface PatternFinding {
  ruleId: string
  ruleTitle: string
  filePath: string
  line: number
  endLine?: number
  message: string
  severity: "info" | "warning" | "error"
  suggestion: string | null
  adherenceRate?: number
  semgrepRuleId?: string
  autoFix?: { fixedCode: string; confidence: number } | null
}

export interface ImpactFinding {
  entityId: string
  entityName: string
  filePath: string
  line: number
  callerCount: number
  topCallers: Array<{ name: string; filePath: string }>
}

export interface TestFinding {
  filePath: string
  expectedTestPath: string
  message: string
}

export interface ComplexityFinding {
  entityId: string
  entityName: string
  filePath: string
  line: number
  complexity: number
  threshold: number
}

export interface DependencyFinding {
  filePath: string
  importPath: string
  line: number
  message: string
}

export interface TrustBoundaryFinding {
  sourceEntity: { id: string; name: string; filePath: string }
  sinkEntity: { id: string; name: string; filePath: string }
  pathLength: number
  filePath: string
  line: number
  message: string
}

export interface EnvFinding {
  filePath: string
  line: number
  envVar: string
  message: string
}

export interface ContractFinding {
  changedEntity: { id: string; name: string; filePath: string }
  affectedRoute: { name: string; kind: string; filePath: string }
  depth: number
  callerCount: number
  filePath: string
  line: number
  message: string
}

export interface IdempotencyFinding {
  triggerEntity: { id: string; name: string; filePath: string }
  mutationEntity: { id: string; name: string; filePath: string }
  filePath: string
  line: number
  message: string
}

export interface BoundedContextFinding {
  sourceFeature: string
  targetFeature: string
  sourceEntity: { id: string; name: string; filePath: string }
  targetEntity: { id: string; name: string; filePath: string }
  message: string
}

export interface BlastRadiusSummary {
  entity: string
  filePath: string
  upstreamBoundaries: Array<{
    name: string
    kind: string
    filePath: string
    depth: number
    path: string
  }>
  callerCount: number
}

export interface ReviewCheckAnnotation {
  path: string
  start_line: number
  end_line: number
  annotation_level: "notice" | "warning" | "failure"
  message: string
  title: string
  raw_details: string
}

export interface AdrContent {
  title: string
  context: string
  decision: string
  consequences: string
  relatedEntities: string[]
  relatedFeatureAreas: string[]
}

export interface MergeNodeDoc {
  id: string
  org_id: string
  repo_id: string
  source_branch: string
  target_branch: string
  pr_number: number
  merged_by: string
  entry_count: number
  narrative?: string
  created_at: string
}
