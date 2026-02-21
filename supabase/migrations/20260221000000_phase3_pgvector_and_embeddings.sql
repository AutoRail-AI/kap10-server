-- Phase 3: Enable pgvector extension and create entity_embeddings table
-- Provides semantic search via vector cosine similarity

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add new RepoStatus enum values for embedding pipeline
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction in PG < 16.
-- The migration runner must handle this by running outside BEGIN/COMMIT.
ALTER TYPE kap10."RepoStatus" ADD VALUE IF NOT EXISTS 'embedding' AFTER 'indexing';
ALTER TYPE kap10."RepoStatus" ADD VALUE IF NOT EXISTS 'embed_failed' AFTER 'error';

-- Create entity_embeddings table in kap10 schema
-- model_version enables zero-downtime blue/green re-embedding on model upgrades
-- Use fully-qualified extensions.vector to avoid search_path issues
CREATE TABLE IF NOT EXISTS kap10.entity_embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL,
  entity_key      TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_name     TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  text_content    TEXT NOT NULL,
  model_version   TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  embedding       extensions.vector(768) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Foreign key to repos table
  CONSTRAINT fk_entity_embeddings_repo
    FOREIGN KEY (repo_id) REFERENCES kap10.repos(id) ON DELETE CASCADE,

  -- Upsert by (repo_id, entity_key, model_version) — idempotent + version-safe
  CONSTRAINT uq_entity_embeddings_repo_entity_version
    UNIQUE (repo_id, entity_key, model_version)
);

-- HNSW index for cosine distance (approximate nearest-neighbor search)
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw
  ON kap10.entity_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_org_repo
  ON kap10.entity_embeddings (org_id, repo_id);

-- Index for orphan cleanup (lookup by repo_id + entity_key)
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_repo_entity
  ON kap10.entity_embeddings (repo_id, entity_key);
