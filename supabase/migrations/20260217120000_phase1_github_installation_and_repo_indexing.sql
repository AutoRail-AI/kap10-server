-- =============================================================================
-- Phase 1: GitHub App installation and repo indexing fields
-- =============================================================================
-- Creates github_installations table and extends repos with indexing metadata.
-- =============================================================================

-- GitHub App installation per org (installation token fetched on demand via @octokit/auth-app)
CREATE TABLE IF NOT EXISTS kap10.github_installations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  installation_id BIGINT NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  permissions JSONB,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_github_installations_organization_id ON kap10.github_installations(organization_id);

-- Extend repos with Phase 1 indexing fields
ALTER TABLE kap10.repos
  ADD COLUMN IF NOT EXISTS github_repo_id BIGINT,
  ADD COLUMN IF NOT EXISTS github_full_name TEXT,
  ADD COLUMN IF NOT EXISTS last_indexed_sha TEXT,
  ADD COLUMN IF NOT EXISTS index_progress INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS function_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS class_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS workflow_id TEXT;
