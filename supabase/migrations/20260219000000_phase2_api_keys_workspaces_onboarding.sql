-- =============================================================================
-- Phase 2: API keys, workspaces, and repo onboarding fields
-- =============================================================================
-- Creates api_keys and workspaces tables, adds onboarding columns to repos.
-- =============================================================================

-- ── Repo onboarding columns ──────────────────────────────────────────
ALTER TABLE kap10.repos
  ADD COLUMN IF NOT EXISTS onboarding_pr_url TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_pr_number INT;

-- ── API Keys table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kap10.api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  repo_id TEXT NOT NULL REFERENCES kap10.repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['mcp:read'],
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id ON kap10.api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON kap10.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_repo_id ON kap10.api_keys(repo_id);

-- ── Workspaces table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kap10.workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_sha TEXT,
  last_sync_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, repo_id, branch)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_expires_at ON kap10.workspaces(expires_at);
