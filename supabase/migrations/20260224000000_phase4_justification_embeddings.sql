-- Phase 4: Business Justification & Taxonomy Layer
-- Adds justification embeddings table + new repo status enum values

-- Add new RepoStatus enum values for justification pipeline
ALTER TYPE "kap10"."RepoStatus" ADD VALUE IF NOT EXISTS 'justifying';
ALTER TYPE "kap10"."RepoStatus" ADD VALUE IF NOT EXISTS 'justify_failed';

-- Phase 4: Justification embeddings for semantic business-purpose search
CREATE TABLE IF NOT EXISTS "kap10"."justification_embeddings" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           TEXT NOT NULL,
  "repo_id"          TEXT NOT NULL REFERENCES "kap10"."repos"("id") ON DELETE CASCADE,
  "entity_id"        TEXT NOT NULL,
  "entity_name"      TEXT NOT NULL,
  "taxonomy"         TEXT NOT NULL,
  "feature_tag"      TEXT NOT NULL,
  "business_purpose" TEXT NOT NULL,
  "model_version"    TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  "embedding"        vector(768),
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one embedding per entity per model version per repo
CREATE UNIQUE INDEX IF NOT EXISTS "justification_embeddings_repo_entity_model_key"
  ON "kap10"."justification_embeddings" ("repo_id", "entity_id", "model_version");

-- Tenant index for fast lookups
CREATE INDEX IF NOT EXISTS "idx_justification_embeddings_org_repo"
  ON "kap10"."justification_embeddings" ("org_id", "repo_id");

-- Taxonomy filter index
CREATE INDEX IF NOT EXISTS "idx_justification_embeddings_taxonomy"
  ON "kap10"."justification_embeddings" ("taxonomy");

-- Feature tag index
CREATE INDEX IF NOT EXISTS "idx_justification_embeddings_feature_tag"
  ON "kap10"."justification_embeddings" ("feature_tag");

-- pgvector HNSW index for fast approximate nearest-neighbor search
CREATE INDEX IF NOT EXISTS "idx_justification_embeddings_hnsw"
  ON "kap10"."justification_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
