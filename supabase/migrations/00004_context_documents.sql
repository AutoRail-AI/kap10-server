-- Add context_documents column for context seeding (Enhancement 1)
ALTER TABLE unerr.repos ADD COLUMN IF NOT EXISTS context_documents TEXT;
