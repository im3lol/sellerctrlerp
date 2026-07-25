-- Per-org print preferences: letterhead overrides + hidden columns per document type.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS print_settings jsonb;
