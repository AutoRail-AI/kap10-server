-- Phase 5: Add incremental indexing columns to repos table
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS incremental_enabled BOOLEAN NOT NULL DEFAULT true;
