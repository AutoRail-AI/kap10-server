-- Pipeline run tracking: every indexing execution gets a unique run with per-step tracking.

-- Enums
CREATE TYPE unerr."PipelineRunStatus" AS ENUM ('running', 'completed', 'failed', 'cancelled');
CREATE TYPE unerr."PipelineTriggerType" AS ENUM ('initial', 'retry', 'reindex', 'webhook');

-- Table
CREATE TABLE unerr.pipeline_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id          TEXT NOT NULL REFERENCES unerr.repos(id),
  organization_id  TEXT NOT NULL,
  workflow_id      TEXT,
  temporal_run_id  TEXT,
  status           unerr."PipelineRunStatus" NOT NULL DEFAULT 'running',
  trigger_type     unerr."PipelineTriggerType" NOT NULL,
  trigger_user_id  TEXT,
  pipeline_type    TEXT NOT NULL DEFAULT 'full',
  index_version    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  duration_ms      INT,
  error_message    TEXT,
  steps            JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_count       INT,
  function_count   INT,
  class_count      INT,
  entities_written INT,
  edges_written    INT
);

-- Indexes
CREATE INDEX idx_pipeline_runs_repo_id ON unerr.pipeline_runs (repo_id);
CREATE INDEX idx_pipeline_runs_org_id ON unerr.pipeline_runs (organization_id);
CREATE INDEX idx_pipeline_runs_status ON unerr.pipeline_runs (status);
CREATE INDEX idx_pipeline_runs_repo_started ON unerr.pipeline_runs (repo_id, started_at DESC);
