-- Phase 10a: Graph Snapshots for Local-First Intelligence Proxy
-- Creates snapshot metadata table and Supabase Storage bucket for msgpack graph exports.

-- ── Enum ──────────────────────────────────────────────────────────────
CREATE TYPE kap10.snapshot_status AS ENUM ('generating', 'available', 'failed');

-- ── Table ─────────────────────────────────────────────────────────────
CREATE TABLE kap10.graph_snapshot_meta (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL,
  repo_id      TEXT NOT NULL UNIQUE,
  status       kap10.snapshot_status NOT NULL DEFAULT 'generating',
  checksum     TEXT,               -- SHA-256 hex digest of msgpack blob
  storage_path TEXT,               -- Supabase Storage path (graph-snapshots/{orgId}/{repoId}.msgpack)
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  entity_count INTEGER NOT NULL DEFAULT 0,
  edge_count   INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_graph_snapshot_meta_org_id ON kap10.graph_snapshot_meta (org_id);

-- ── Supabase Storage bucket ───────────────────────────────────────────
-- Private bucket, 100 MB file size limit, for msgpack graph snapshots.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('graph-snapshots', 'graph-snapshots', false, 104857600)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies ──────────────────────────────────────────────────────
-- Org members can download snapshots (SELECT on storage objects)
CREATE POLICY "Org members can download graph snapshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'graph-snapshots');

-- Service role can upload (INSERT/UPDATE) — handled by default service role bypass
