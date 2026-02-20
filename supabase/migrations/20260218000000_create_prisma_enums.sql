-- =============================================================================
-- Create PostgreSQL enum types in kap10 schema to match Prisma enum definitions.
-- Prisma 7 generates SQL that casts literals to enum types (e.g. 'pending'::kap10."RepoStatus"),
-- so the actual enum types must exist in the database.
--
-- Steps: 1) Create enum types  2) Drop CHECK constraints  3) Convert columns
-- =============================================================================

-- 1. Create enum types (idempotent)
DO $$ BEGIN
  CREATE TYPE kap10."RepoStatus" AS ENUM ('pending', 'indexing', 'ready', 'error', 'deleting');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kap10."RepoProvider" AS ENUM ('github');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kap10."DeletionLogStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Drop CHECK constraints BEFORE altering column types (avoids operator mismatch)
DO $$ BEGIN
  ALTER TABLE kap10.repos DROP CONSTRAINT IF EXISTS repos_status_check;
  ALTER TABLE kap10.repos DROP CONSTRAINT IF EXISTS repos_provider_check;
  ALTER TABLE kap10.deletion_logs DROP CONSTRAINT IF EXISTS deletion_logs_status_check;
END $$;

-- Also drop any auto-generated constraint names (Supabase/pg may name them differently)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'kap10'
      AND rel.relname IN ('repos', 'deletion_logs')
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE kap10.%I DROP CONSTRAINT IF EXISTS %I',
      (SELECT relname FROM pg_class WHERE oid = (SELECT conrelid FROM pg_constraint WHERE conname = r.conname)),
      r.conname);
  END LOOP;
END $$;

-- 3. Convert columns from TEXT to enum types
ALTER TABLE kap10.repos
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE kap10."RepoStatus" USING status::kap10."RepoStatus",
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE kap10.repos
  ALTER COLUMN provider TYPE kap10."RepoProvider" USING provider::kap10."RepoProvider";

ALTER TABLE kap10.deletion_logs
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE kap10."DeletionLogStatus" USING status::kap10."DeletionLogStatus",
  ALTER COLUMN status SET DEFAULT 'pending';
