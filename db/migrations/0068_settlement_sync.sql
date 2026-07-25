-- Amazon settlement auto-pull: per-platform toggles + a credential watermark.
-- sync_settlements gates the pull (like the other per-source sync toggles);
-- auto_post_settlements decides whether a pull posts to GL automatically (off =
-- pull only, operator posts from the settlements screen). Columns live on the
-- existing tables → RLS already covers them.

ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS sync_settlements boolean NOT NULL DEFAULT true;
ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS auto_post_settlements boolean NOT NULL DEFAULT false;
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS settlements_synced_at timestamptz;
