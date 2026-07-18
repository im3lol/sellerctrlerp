import "server-only";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";

export const BACKUP_VERSION = 1;

/**
 * A per-tenant logical backup: every row this org owns, across every table that has an
 * `organization_id`, dumped to gzipped JSON. It runs INSIDE the org's RLS scope, so a
 * plain `SELECT *` on each table already returns only this org's rows — the same
 * isolation the app enforces, reused as the backup boundary. Tables are discovered from
 * information_schema, so a newly-added org table is included automatically (no drift).
 *
 * ponytail: loads each table fully into memory before gzipping — fine at current scale;
 * a very large tenant would want row-streaming (upgrade path: COPY … TO per table).
 */
export type OrgBackup = { buffer: Buffer; filename: string; totalRows: number; tableCount: number; exportedAt: string };

export function exportOrgData(orgId: string, orgName = "org"): Promise<OrgBackup> {
  return withOrgScope(orgId, false, async () => {
    const tableRows = await db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organization_id'
      ORDER BY table_name`);
    const tables = tableRows.rows.map((r) => r.table_name).filter((t) => /^[a-z0-9_]+$/.test(t));

    const data: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const t of tables) {
      // Explicit org filter (not RLS-only) so the boundary holds even if the connecting
      // role bypasses RLS. sql.identifier quotes the (catalog-derived) name; orgId is a param.
      const res = await db.execute(sql`SELECT * FROM ${sql.identifier(t)} WHERE organization_id = ${orgId}`);
      data[t] = res.rows;
      totalRows += res.rows.length;
    }

    const exportedAt = new Date().toISOString();
    const payload = {
      meta: { version: BACKUP_VERSION, orgId, orgName, exportedAt, tableCount: tables.length, totalRows },
      data,
    };
    const json = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const buffer = gzipSync(Buffer.from(json, "utf8"));
    const stamp = exportedAt.slice(0, 19).replace(/[:T]/g, "-");
    return { buffer, filename: `backup-${orgId}-${stamp}.json.gz`, totalRows, tableCount: tables.length, exportedAt };
  });
}
