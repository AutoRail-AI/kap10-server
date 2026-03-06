-- Phase 13: Immutable Source Artifacts & Multi-Branch Code Intelligence
-- Tables: scip_indexes, branch_refs, workspace_syncs, nearest_indexed_commits
-- Columns: repos.branch_tracking_enabled, repos.workspace_tracking_enabled

-- ── New columns on repos ─────────────────────────────────────────────────────

ALTER TABLE unerr.repos
  ADD COLUMN IF NOT EXISTS branch_tracking_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_tracking_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── SCIP index artifact cache ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unerr.scip_indexes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  commit_sha      TEXT NOT NULL,
  indexer_root    TEXT NOT NULL DEFAULT '.',
  storage_path    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  language_stats  JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo_id, commit_sha, indexer_root)
);

CREATE INDEX IF NOT EXISTS idx_scip_indexes_org_repo ON unerr.scip_indexes (org_id, repo_id);

-- ── Branch ref tracking ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unerr.branch_refs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL,
  repo_id           TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  branch_name       TEXT NOT NULL,
  head_sha          TEXT NOT NULL,
  last_indexed_sha  TEXT,
  last_indexed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo_id, branch_name)
);

CREATE INDEX IF NOT EXISTS idx_branch_refs_org_repo ON unerr.branch_refs (org_id, repo_id);

-- ── Workspace sync tracking ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unerr.workspace_syncs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL,
  repo_id       TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  commit_sha    TEXT NOT NULL,
  base_sha      TEXT,
  file_count    INTEGER NOT NULL DEFAULT 0,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_syncs_org_repo_user ON unerr.workspace_syncs (org_id, repo_id, user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_syncs_latest ON unerr.workspace_syncs (repo_id, user_id, synced_at DESC);

-- ── Nearest indexed commit cache ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unerr.nearest_indexed_commits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  query_sha       TEXT NOT NULL,
  nearest_sha     TEXT NOT NULL,
  distance        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo_id, query_sha)
);

CREATE INDEX IF NOT EXISTS idx_nearest_indexed_commits_org_repo ON unerr.nearest_indexed_commits (org_id, repo_id);
