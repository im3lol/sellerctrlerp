-- Acquisition attribution: where a tenant came from at signup (utm_source or referrer host).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS signup_source text;
