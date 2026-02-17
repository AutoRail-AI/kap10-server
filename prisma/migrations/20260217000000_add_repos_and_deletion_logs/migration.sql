-- CreateEnum
CREATE TYPE "RepoStatus" AS ENUM ('pending', 'indexing', 'ready', 'error', 'deleting');

-- CreateEnum
CREATE TYPE "RepoProvider" AS ENUM ('github');

-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "provider" "RepoProvider" NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" "RepoStatus" NOT NULL DEFAULT 'pending',
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "last_indexed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "DeletionLogStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateTable
CREATE TABLE "deletion_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "repo_id" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "entities_deleted" INTEGER NOT NULL DEFAULT 0,
    "embeddings_deleted" INTEGER NOT NULL DEFAULT 0,
    "status" "DeletionLogStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,

    CONSTRAINT "deletion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repos_organization_id_idx" ON "repos"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "repos_organization_id_provider_provider_id_key" ON "repos"("organization_id", "provider", "provider_id");

-- CreateIndex
CREATE INDEX "deletion_logs_organization_id_idx" ON "deletion_logs"("organization_id");

-- CreateIndex
CREATE INDEX "deletion_logs_status_idx" ON "deletion_logs"("status");
