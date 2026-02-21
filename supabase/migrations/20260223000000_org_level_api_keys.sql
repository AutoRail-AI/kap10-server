-- Make repo_id optional (org-level API keys)
ALTER TABLE kap10.api_keys ALTER COLUMN repo_id DROP NOT NULL;

-- Add is_default flag for auto-provisioned keys
ALTER TABLE kap10.api_keys ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;
