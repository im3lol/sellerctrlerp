import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentLinks } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type DocRelation = "FULFILLS" | "INVOICES" | "RETURNS" | "SETTLES";

/** Record a directed link between two documents (idempotent-ish; callers link once per event). */
export async function linkDocuments(
  exec: Exec,
  input: {
    orgId: string;
    fromType: string; fromId: string; fromNumber?: string | null;
    toType: string; toId: string; toNumber?: string | null;
    relation: DocRelation;
  },
): Promise<void> {
  await exec.insert(documentLinks).values({
    organizationId: input.orgId,
    fromType: input.fromType, fromId: input.fromId, fromNumber: input.fromNumber ?? null,
    toType: input.toType, toId: input.toId, toNumber: input.toNumber ?? null,
    relation: input.relation,
  });
}

export type RelatedDoc = { type: string; id: string; number: string | null; relation: string; direction: "from" | "to" };

/** All documents linked to a given one, in either direction. */
export async function getRelatedDocuments(orgId: string, type: string, id: string): Promise<RelatedDoc[]> {
  const rows = await db.select().from(documentLinks).where(
    and(
      eq(documentLinks.organizationId, orgId),
      or(
        and(eq(documentLinks.fromType, type), eq(documentLinks.fromId, id)),
        and(eq(documentLinks.toType, type), eq(documentLinks.toId, id)),
      ),
    ),
  );
  const out: RelatedDoc[] = [];
  for (const r of rows) {
    if (r.fromType === type && r.fromId === id) {
      out.push({ type: r.toType, id: r.toId, number: r.toNumber, relation: r.relation, direction: "to" });
    } else {
      out.push({ type: r.fromType, id: r.fromId, number: r.fromNumber, relation: r.relation, direction: "from" });
    }
  }
  return out;
}
