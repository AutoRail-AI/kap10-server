-- Add ON DELETE CASCADE to all repo-related foreign keys
-- so deleting a repo automatically cleans up all associated data.

-- pipeline_runs: drop and re-add FK with CASCADE
ALTER TABLE unerr.pipeline_runs
  DROP CONSTRAINT IF EXISTS "pipeline_runs_repo_id_fkey",
  ADD CONSTRAINT "pipeline_runs_repo_id_fkey"
    FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;

-- justification_embeddings: add FK with CASCADE (was missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'justification_embeddings_repo_id_fkey'
      AND table_schema = 'unerr'
  ) THEN
    ALTER TABLE unerr.justification_embeddings
      ADD CONSTRAINT "justification_embeddings_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE unerr.justification_embeddings
      DROP CONSTRAINT "justification_embeddings_repo_id_fkey",
      ADD CONSTRAINT "justification_embeddings_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  END IF;
END $$;

-- rule_embeddings: add FK with CASCADE (was missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rule_embeddings_repo_id_fkey'
      AND table_schema = 'unerr'
  ) THEN
    ALTER TABLE unerr.rule_embeddings
      ADD CONSTRAINT "rule_embeddings_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE unerr.rule_embeddings
      DROP CONSTRAINT "rule_embeddings_repo_id_fkey",
      ADD CONSTRAINT "rule_embeddings_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  END IF;
END $$;

-- workspaces: add FK with CASCADE (was missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workspaces_repo_id_fkey'
      AND table_schema = 'unerr'
  ) THEN
    ALTER TABLE unerr.workspaces
      ADD CONSTRAINT "workspaces_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE unerr.workspaces
      DROP CONSTRAINT "workspaces_repo_id_fkey",
      ADD CONSTRAINT "workspaces_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  END IF;
END $$;

-- graph_snapshot_meta: add FK with CASCADE (was missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'graph_snapshot_meta_repo_id_fkey'
      AND table_schema = 'unerr'
  ) THEN
    ALTER TABLE unerr.graph_snapshot_meta
      ADD CONSTRAINT "graph_snapshot_meta_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE unerr.graph_snapshot_meta
      DROP CONSTRAINT "graph_snapshot_meta_repo_id_fkey",
      ADD CONSTRAINT "graph_snapshot_meta_repo_id_fkey"
        FOREIGN KEY (repo_id) REFERENCES unerr.repos(id) ON DELETE CASCADE;
  END IF;
END $$;
