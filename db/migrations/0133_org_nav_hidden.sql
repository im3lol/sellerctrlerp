-- Sections the owner has hidden from the sidebar. Display only: permissions and the
-- subscription decide ACCESS, this only decides what clutters the list. A hidden
-- section's pages stay reachable by direct link for anyone allowed to open them.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS nav_hidden jsonb;
