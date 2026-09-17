import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { DOCS, type Facts, type FieldType } from "@/lib/erp/automation/model";

// Identifiers come only from the DOCS registry (static strings), never from a rule.
const ident = (s: string) => sql.raw(`"${s}"`);

const cairoDate = (v: unknown) => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
};

function norm(v: unknown, type: FieldType): string | number | null {
  if (v == null) return null;
  if (type === "number") return Number.isFinite(Number(v)) ? Number(v) : null;
  if (type === "date") return cairoDate(v);
  return String(v);
}

/**
 * What a rule can read on one document, plus who created it (the first CREATE in the audit
 * trail — most documents keep no creator column). Call inside the org's scope. Null when
 * the document is gone (a DELETE event).
 */
export async function loadFacts(orgId: string, entity: string, id: string): Promise<{ facts: Facts; creatorId: string | null } | null> {
  const def = DOCS[entity];
  if (!def) return null;

  const selects: SQL[] = Object.entries(def.cols).map(([key, c]) => sql`t.${ident(c.col)} AS ${ident(key)}`);
  if (def.party) selects.push(sql`p.name_ar AS "party"`);
  if (def.warehouse) selects.push(sql`w.name_ar AS "warehouse"`);

  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT ${sql.join(selects, sql`, `)}
    FROM ${ident(def.table)} t
    ${def.party ? sql`LEFT JOIN ${ident(def.party.table)} p ON p.id = t.${ident(def.party.col)}` : sql``}
    ${def.warehouse ? sql`LEFT JOIN warehouses w ON w.id = t.${ident(def.warehouse)}` : sql``}
    WHERE t.id = ${id} AND t.organization_id = ${orgId}
    LIMIT 1`);
  const row = rows[0];
  if (!row) return null;

  const facts: Facts = {};
  for (const [key, c] of Object.entries(def.cols)) facts[key] = norm(row[key], c.type);
  if (def.party) facts.party = norm(row.party, "text");
  if (def.warehouse) facts.warehouse = norm(row.warehouse, "text");

  const { rows: created } = await db.execute<{ user_id: string | null }>(sql`
    SELECT user_id FROM audit_logs
    WHERE organization_id = ${orgId} AND entity_id = ${id} AND action = 'CREATE'
    ORDER BY created_at LIMIT 1`);
  return { facts, creatorId: created[0]?.user_id ?? null };
}

/** Find a document by its number — for trying a rule out on a real one. */
export async function findDocId(orgId: string, entity: string, number: string): Promise<string | null> {
  const def = DOCS[entity];
  if (!def) return null;
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM ${ident(def.table)} WHERE organization_id = ${orgId} AND number = ${number.trim()} LIMIT 1`);
  return rows[0]?.id ?? null;
}
