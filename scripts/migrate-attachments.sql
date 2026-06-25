-- Document attachments (base64-encoded file content stored in Postgres)
CREATE TABLE IF NOT EXISTS document_attachments (
  id            text        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  organization_id text      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type   text        NOT NULL,
  entity_id     text        NOT NULL,
  file_name     text        NOT NULL,
  file_size     integer     NOT NULL,
  mime_type     text        NOT NULL,
  content       text        NOT NULL,
  uploaded_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_attachments_entity_idx
  ON document_attachments (organization_id, entity_type, entity_id);
