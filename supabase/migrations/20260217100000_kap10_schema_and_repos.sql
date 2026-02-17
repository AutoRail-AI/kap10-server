-- =============================================================================
-- Kap10 schema and Prisma-managed tables (repos, deletion_logs)
-- =============================================================================
-- Prisma schema uses @@schema("kap10"). This migration creates the schema and
-- tables so PrismaRelationalStore can query them. Run: pnpm migrate
-- =============================================================================

-- Create kap10 schema (all kap10 app tables live here; Better Auth stays in public)
CREATE SCHEMA IF NOT EXISTS kap10;

-- Repos (matches prisma/schema.prisma Repo model)
CREATE TABLE IF NOT EXISTS kap10.repos (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github')),
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'error', 'deleting')),
  default_branch TEXT NOT NULL DEFAULT 'main',
  last_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_repos_organization_id ON kap10.repos(organization_id);

-- Deletion logs (matches prisma/schema.prisma DeletionLog model)
CREATE TABLE IF NOT EXISTS kap10.deletion_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  repo_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  entities_deleted INT NOT NULL DEFAULT 0,
  embeddings_deleted INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_organization_id ON kap10.deletion_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_deletion_logs_status ON kap10.deletion_logs(status);
