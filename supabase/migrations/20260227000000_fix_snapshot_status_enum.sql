-- Fix SnapshotStatus enum: rename from snake_case to PascalCase to match Prisma expectations.
-- Prisma 7 with PrismaPg adapter expects kap10."SnapshotStatus" (PascalCase),
-- but the Phase 10a migration created it as kap10.snapshot_status (snake_case).
-- All other enums (RepoStatus, RepoProvider, DeletionLogStatus) already use PascalCase.

-- Step 1: Rename the enum type from snake_case to PascalCase
ALTER TYPE kap10.snapshot_status RENAME TO "SnapshotStatus";

-- Step 2: Convert the column to use the renamed type
-- (The column already references the type, so renaming the type is sufficient.
--  PostgreSQL propagates the rename to all columns that use the type.)
