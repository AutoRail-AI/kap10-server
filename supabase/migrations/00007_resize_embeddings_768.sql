-- Resize vector columns for Gemini Embedding 001 (768 dims)
ALTER TABLE unerr.entity_embeddings ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE unerr.justification_embeddings ALTER COLUMN embedding TYPE vector(768);
