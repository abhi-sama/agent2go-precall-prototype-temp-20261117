-- Ticket 08: explicit provenance and provider metadata for pgvector-backed insight retrieval.
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS embedding_provider text NOT NULL DEFAULT 'local';
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'local-open-source';
CREATE INDEX IF NOT EXISTS embeddings_insight_lookup_idx ON embeddings(source_table, source_record_id);
