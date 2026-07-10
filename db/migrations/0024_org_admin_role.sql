-- Tenant-owner role for self-service SaaS signup (full ERP access, no platform admin).
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'org_admin' BEFORE 'ops_manager';
