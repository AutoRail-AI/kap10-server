-- Phase 5.5: Ledger Snapshots, Rule Embeddings, CLI Uploads bucket, local_cli provider
-- =====================================================================================

-- Add local_cli to RepoProvider enum
ALTER TYPE kap10."RepoProvider" ADD VALUE IF NOT EXISTS 'local_cli';

-- Add Phase 5.5 columns to repos table
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS local_cli_upload_path TEXT;
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS ephemeral_expires_at TIMESTAMPTZ;

-- Ledger snapshots table (stores working-state file snapshots)
CREATE TABLE IF NOT EXISTS kap10.ledger_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         UUID NOT NULL REFERENCES kap10.repos(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  timeline_branch INTEGER NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  reason          TEXT NOT NULL,
  files           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_snapshots_org_repo_branch
  ON kap10.ledger_snapshots(org_id, repo_id, branch);
CREATE INDEX IF NOT EXISTS idx_ledger_snapshots_entry
  ON kap10.ledger_snapshots(ledger_entry_id);

-- Rule embeddings table (anti-pattern vectorization)
CREATE TABLE IF NOT EXISTS kap10.rule_embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         UUID NOT NULL,
  rule_id         TEXT NOT NULL,
  rule_name       TEXT NOT NULL,
  rule_type       TEXT NOT NULL,
  text_content    TEXT NOT NULL,
  model_version   TEXT NOT NULL DEFAULT 'nomic-v1.5-768',
  embedding       extensions.vector(768),
  matched_entities TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, rule_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_rule_embeddings_org_repo
  ON kap10.rule_embeddings(org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_rule_embeddings_type
  ON kap10.rule_embeddings(rule_type);

-- Create cli_uploads storage bucket (private, 500MB max)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cli_uploads', 'cli_uploads', false, 524288000)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: authenticated users can upload to their org folder
CREATE POLICY IF NOT EXISTS "cli_uploads_org_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'cli_uploads');

CREATE POLICY IF NOT EXISTS "cli_uploads_org_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'cli_uploads');

CREATE POLICY IF NOT EXISTS "cli_uploads_service_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'cli_uploads');
