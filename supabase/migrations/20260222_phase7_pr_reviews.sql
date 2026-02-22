-- Phase 7: PR Review Integration tables

CREATE TABLE IF NOT EXISTS kap10.pr_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES kap10.repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL DEFAULT '',
  pr_url TEXT NOT NULL DEFAULT '',
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'completed', 'failed')),
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_warned INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  review_body TEXT,
  github_review_id BIGINT,
  github_check_run_id BIGINT,
  auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_pr_reviews_repo_id ON kap10.pr_reviews(repo_id);
CREATE INDEX idx_pr_reviews_pr_number ON kap10.pr_reviews(repo_id, pr_number);
CREATE INDEX idx_pr_reviews_status ON kap10.pr_reviews(status);
CREATE UNIQUE INDEX idx_pr_reviews_idempotent ON kap10.pr_reviews(repo_id, pr_number, head_sha);

CREATE TABLE IF NOT EXISTS kap10.pr_review_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES kap10.pr_reviews(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  check_type TEXT NOT NULL CHECK (check_type IN ('pattern', 'impact', 'test', 'complexity', 'dependency')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  suggestion TEXT,
  semgrep_rule_id TEXT,
  rule_title TEXT,
  github_comment_id BIGINT,
  auto_fix TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pr_review_comments_review ON kap10.pr_review_comments(review_id);
CREATE INDEX idx_pr_review_comments_severity ON kap10.pr_review_comments(severity);

-- Add review_config JSON column to repos table
ALTER TABLE kap10.repos ADD COLUMN IF NOT EXISTS review_config JSONB DEFAULT NULL;
