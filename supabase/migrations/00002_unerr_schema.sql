-- =============================================================================
-- Consolidated unerr schema: All unerr app tables
-- =============================================================================
-- Single migration replacing 15 incremental files (pre-launch consolidation).
-- All unerr-managed tables live in PostgreSQL schema "unerr".
-- Better Auth tables stay in "public" (see 00001_public_schema.sql).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS unerr;

-- ═════════════════════════════════════════════════════════════════════════
-- Enums
-- ═════════════════════════════════════════════════════════════════════════

CREATE TYPE unerr."RepoStatus" AS ENUM (
  'pending', 'indexing', 'embedding', 'ready',
  'error', 'embed_failed', 'deleting',
  'justifying', 'justify_failed'
);

CREATE TYPE unerr."RepoProvider" AS ENUM ('github', 'local_cli');

CREATE TYPE unerr."DeletionLogStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE TYPE unerr."SnapshotStatus" AS ENUM ('generating', 'available', 'failed');

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════

-- ── Repos ─────────────────────────────────────────────────────────────
CREATE TABLE unerr.repos (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  provider              unerr."RepoProvider" NOT NULL,
  provider_id           TEXT NOT NULL,
  status                unerr."RepoStatus" NOT NULL DEFAULT 'pending',
  default_branch        TEXT NOT NULL DEFAULT 'main',
  last_indexed_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Indexing metadata
  github_repo_id        BIGINT,
  github_full_name      TEXT,
  last_indexed_sha      TEXT,
  index_progress        INT NOT NULL DEFAULT 0,
  file_count            INT NOT NULL DEFAULT 0,
  function_count        INT NOT NULL DEFAULT 0,
  class_count           INT NOT NULL DEFAULT 0,
  error_message         TEXT,
  workflow_id           TEXT,
  -- Onboarding
  onboarding_pr_url     TEXT,
  onboarding_pr_number  INT,
  -- Incremental indexing
  webhook_secret        TEXT,
  incremental_enabled   BOOLEAN NOT NULL DEFAULT true,
  -- Local CLI
  local_cli_upload_path TEXT,
  ephemeral             BOOLEAN NOT NULL DEFAULT false,
  ephemeral_expires_at  TIMESTAMPTZ,
  -- PR review config
  review_config         JSONB DEFAULT NULL,

  UNIQUE (organization_id, provider, provider_id)
);

-- ── GitHub Installations ──────────────────────────────────────────────
CREATE TABLE unerr.github_installations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  installation_id BIGINT NOT NULL,
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL,
  permissions     JSONB,
  suspended_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, installation_id)
);

-- ── Deletion Logs ─────────────────────────────────────────────────────
CREATE TABLE unerr.deletion_logs (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL,
  repo_id            TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  entities_deleted   INT NOT NULL DEFAULT 0,
  embeddings_deleted INT NOT NULL DEFAULT 0,
  status             unerr."DeletionLogStatus" NOT NULL DEFAULT 'pending',
  error_message      TEXT
);

-- ── API Keys (unerr — org-level or repo-scoped) ──────────────────────
CREATE TABLE unerr.api_keys (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  repo_id         TEXT REFERENCES unerr.repos(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,
  key_hash        TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT ARRAY['mcp:read'],
  is_default      BOOLEAN NOT NULL DEFAULT false,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Workspaces ────────────────────────────────────────────────────────
CREATE TABLE unerr.workspaces (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  repo_id     TEXT NOT NULL,
  branch      TEXT NOT NULL,
  base_sha    TEXT,
  last_sync_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, repo_id, branch)
);

-- ── Entity Embeddings (pgvector) ──────────────────────────────────────
CREATE TABLE unerr.entity_embeddings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT NOT NULL,
  repo_id        TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  entity_key     TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_name    TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  text_content   TEXT NOT NULL,
  model_version  TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  embedding      extensions.vector(768) NOT NULL,
  vector_version UUID DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo_id, entity_key, model_version)
);

-- ── Justification Embeddings (pgvector) ───────────────────────────────
CREATE TABLE unerr.justification_embeddings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  repo_id          TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  entity_id        TEXT NOT NULL,
  entity_name      TEXT NOT NULL,
  taxonomy         TEXT NOT NULL,
  feature_tag      TEXT NOT NULL,
  business_purpose TEXT NOT NULL,
  model_version    TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  embedding        vector(768),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo_id, entity_id, model_version)
);

-- ── Graph Snapshot Meta ───────────────────────────────────────────────
CREATE TABLE unerr.graph_snapshot_meta (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL,
  repo_id      TEXT NOT NULL UNIQUE,
  status       unerr."SnapshotStatus" NOT NULL DEFAULT 'generating',
  checksum     TEXT,
  storage_path TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  entity_count INTEGER NOT NULL DEFAULT 0,
  edge_count   INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── PR Reviews ────────────────────────────────────────────────────────
CREATE TABLE unerr.pr_reviews (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id             TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  pr_number           INTEGER NOT NULL,
  pr_title            TEXT NOT NULL DEFAULT '',
  pr_url              TEXT NOT NULL DEFAULT '',
  head_sha            TEXT NOT NULL,
  base_sha            TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'completed', 'failed')),
  checks_passed       INTEGER NOT NULL DEFAULT 0,
  checks_warned       INTEGER NOT NULL DEFAULT 0,
  checks_failed       INTEGER NOT NULL DEFAULT 0,
  review_body         TEXT,
  github_review_id    BIGINT,
  github_check_run_id BIGINT,
  auto_approved       BOOLEAN NOT NULL DEFAULT FALSE,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

-- ── PR Review Comments ────────────────────────────────────────────────
CREATE TABLE unerr.pr_review_comments (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  review_id         UUID NOT NULL REFERENCES unerr.pr_reviews(id) ON DELETE CASCADE,
  file_path         TEXT NOT NULL,
  line_number       INTEGER NOT NULL,
  check_type        TEXT NOT NULL CHECK (check_type IN ('pattern', 'impact', 'test', 'complexity', 'dependency')),
  severity          TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message           TEXT NOT NULL,
  suggestion        TEXT,
  semgrep_rule_id   TEXT,
  rule_title        TEXT,
  github_comment_id BIGINT,
  auto_fix          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Active Vector Versions (blue/green re-embedding) ──────────────────
CREATE TABLE unerr.active_vector_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  repo_id          TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  active_version   UUID NOT NULL,
  previous_version UUID,
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(repo_id)
);

-- ── Ledger Snapshots ──────────────────────────────────────────────────
CREATE TABLE unerr.ledger_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  timeline_branch INTEGER NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  reason          TEXT NOT NULL,
  files           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Rule Embeddings (pgvector) ────────────────────────────────────────
CREATE TABLE unerr.rule_embeddings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  repo_id          TEXT NOT NULL,
  rule_id          TEXT NOT NULL,
  rule_name        TEXT NOT NULL,
  rule_type        TEXT NOT NULL,
  text_content     TEXT NOT NULL,
  model_version    TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  embedding        vector(768),
  matched_entities TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(repo_id, rule_id, model_version)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Vector indexes (HNSW for approximate nearest-neighbor search)
-- ═════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw
  ON unerr.entity_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_justification_embeddings_hnsw
  ON unerr.justification_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ═════════════════════════════════════════════════════════════════════════
-- Storage buckets (Supabase Storage)
-- ═════════════════════════════════════════════════════════════════════════

-- Graph snapshots bucket (private, 100 MB max)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('graph-snapshots', 'graph-snapshots', false, 104857600)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can download graph snapshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'graph-snapshots');

-- CLI uploads bucket (private, 500 MB max)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('cli_uploads', 'cli_uploads', false, 524288000)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    BEGIN
      CREATE POLICY "cli_uploads_org_insert"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'cli_uploads');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      CREATE POLICY "cli_uploads_org_select"
        ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'cli_uploads');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      CREATE POLICY "cli_uploads_service_all"
        ON storage.objects FOR ALL TO service_role
        USING (bucket_id = 'cli_uploads');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════

-- Repos
CREATE INDEX IF NOT EXISTS idx_repos_organization_id ON unerr.repos(organization_id);

-- GitHub Installations
CREATE INDEX IF NOT EXISTS idx_github_installations_organization_id ON unerr.github_installations(organization_id);

-- Deletion Logs
CREATE INDEX IF NOT EXISTS idx_deletion_logs_organization_id ON unerr.deletion_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_deletion_logs_status          ON unerr.deletion_logs(status);

-- API Keys (unerr)
CREATE INDEX IF NOT EXISTS idx_unerr_api_keys_organization_id ON unerr.api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_unerr_api_keys_key_hash        ON unerr.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_unerr_api_keys_repo_id         ON unerr.api_keys(repo_id);

-- Workspaces
CREATE INDEX IF NOT EXISTS idx_workspaces_expires_at ON unerr.workspaces(expires_at);

-- Entity Embeddings
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_org_repo     ON unerr.entity_embeddings(org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_repo_entity  ON unerr.entity_embeddings(repo_id, entity_key);
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_model        ON unerr.entity_embeddings(model_version);

-- Justification Embeddings
CREATE INDEX IF NOT EXISTS idx_justification_embeddings_org_repo     ON unerr.justification_embeddings(org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_justification_embeddings_taxonomy     ON unerr.justification_embeddings(taxonomy);
CREATE INDEX IF NOT EXISTS idx_justification_embeddings_feature_tag  ON unerr.justification_embeddings(feature_tag);

-- Graph Snapshot Meta
CREATE INDEX IF NOT EXISTS idx_graph_snapshot_meta_org_id ON unerr.graph_snapshot_meta(org_id);

-- PR Reviews
CREATE INDEX IF NOT EXISTS idx_pr_reviews_repo_id    ON unerr.pr_reviews(repo_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr_number  ON unerr.pr_reviews(repo_id, pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_status      ON unerr.pr_reviews(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_reviews_idempotent ON unerr.pr_reviews(repo_id, pr_number, head_sha);

-- PR Review Comments
CREATE INDEX IF NOT EXISTS idx_pr_review_comments_review   ON unerr.pr_review_comments(review_id);
CREATE INDEX IF NOT EXISTS idx_pr_review_comments_severity ON unerr.pr_review_comments(severity);

-- Active Vector Versions
CREATE INDEX IF NOT EXISTS idx_active_vector_versions_org ON unerr.active_vector_versions(org_id);

-- Ledger Snapshots
CREATE INDEX IF NOT EXISTS idx_ledger_snapshots_org_repo_branch ON unerr.ledger_snapshots(org_id, repo_id, branch);
CREATE INDEX IF NOT EXISTS idx_ledger_snapshots_entry           ON unerr.ledger_snapshots(ledger_entry_id);

-- Rule Embeddings
CREATE INDEX IF NOT EXISTS idx_rule_embeddings_org_repo ON unerr.rule_embeddings(org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_rule_embeddings_type     ON unerr.rule_embeddings(rule_type);
