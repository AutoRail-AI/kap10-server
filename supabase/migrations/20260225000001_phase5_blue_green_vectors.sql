-- Phase 5: Blue/green vector versioning for zero-downtime re-embedding
ALTER TABLE kap10.entity_embeddings ADD COLUMN IF NOT EXISTS vector_version UUID DEFAULT gen_random_uuid();

-- Active vector versions table: tracks which version is live per repo
CREATE TABLE IF NOT EXISTS kap10.active_vector_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL REFERENCES kap10.repos(id) ON DELETE CASCADE,
  active_version UUID NOT NULL,
  previous_version UUID,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id)
);

CREATE INDEX IF NOT EXISTS idx_active_vector_versions_org ON kap10.active_vector_versions(org_id);
