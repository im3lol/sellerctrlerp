-- Move document attachments out of Postgres into object storage: new uploads store the
-- bucket key in `storage_key`; the binary lives in the `sellerctrl` bucket. `content`
-- (base64) becomes nullable and stays for pre-migration rows (read inline until backfilled).
ALTER TABLE document_attachments ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE document_attachments ALTER COLUMN content DROP NOT NULL;
