-- Move kap10 app tables and enums into PostgreSQL schema "kap10" (multi-app Supabase).
-- Run after 20260217000000_add_repos_and_deletion_logs. See VERTICAL_SLICING_PLAN.md.
-- If you previously applied a "prefix" version of this migration (kap10_repos/kap10_deletion_logs in public),
-- rename those back to repos/deletion_logs in public first, then run this migration.

CREATE SCHEMA IF NOT EXISTS kap10;

-- Move enum types first (tables reference them).
ALTER TYPE "RepoStatus" SET SCHEMA kap10;
ALTER TYPE "RepoProvider" SET SCHEMA kap10;
ALTER TYPE "DeletionLogStatus" SET SCHEMA kap10;

-- Move tables.
ALTER TABLE "repos" SET SCHEMA kap10;
ALTER TABLE "deletion_logs" SET SCHEMA kap10;
