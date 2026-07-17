"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accounts, customers, suppliers, items, warehouses,
  openingBalances, openingBalanceLines, salesInvoices, purchaseInvoices,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { totals, validateOpening, weigh, type OpeningLine } from "@/lib/erp/opening-balance";
import { round2 } from "@/lib/erp/money";
import { tryRecordAudit } from "@/lib/erp/audit";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lineSchema = z.object({
  kind: z.enum(["ACCOUNT", "CUSTOMER", "SUPPLIER", "ITEM"]),
  accountId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  itemId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  debit: z.number().optional(),
  credit: z.number().optional(),
  quantity: z.number().optional().nullable(),
  unitCost: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بندًا واحدًا على الأقل"),
});

/** 3002 — the other side of every opening line. Created on first use. */
async function ensureOpeningAccount(orgId: string, tx: Tx): Promise<string> {
  const [found] = await tx.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "3002"))).limit(1);
  if (found) return found.id;
  const [parent] = await tx.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "3"))).limit(1);
  const [row] = await tx.insert(accounts).values({
    organizationId: orgId, code: "3002", nameAr: "حساب الأرصدة الافتتاحية",
    type: "EQUITY", normalBalance: "CREDIT", parentId: parent?.id ?? null, isLeaf: true,
  }).returning({ id: accounts.id });
  return row.id;
}

/**
 * Every id on every line has to belong to this org. Opening balances take more
 * foreign keys from the client than any other document in the system, and a line
 * pointing at another tenant's customer would post their debt into our ledger.
 */
async function assertOwned(orgId: string, lines: OpeningLine[]): Promise<string | null> {
  const ids = (k: keyof OpeningLine) => [...new Set(lines.map((l) => l[k]).filter(Boolean) as string[])];
  const check = async (list: string[], table: typeof customers | typeof suppliers | typeof items | typeof warehouses | typeof accounts, label: string) => {
    if (list.length === 0) return null;
    const found = await db.select({ id: table.id }).from(table)
      .where(and(eq(table.organizationId, orgId), inArray(table.id, list)));
    return found.length === list.length ? null : `${label} غير موجود في هذه المؤسسة`;
  };
  return (
    (await check(ids("accountId"), accounts, "أحد الحسابات")) ??
    (await check(ids("customerId"), customers, "أحد العملاء")) ??
    (await check(ids("supplierId"), suppliers, "أحد الموردين")) ??
    (await check(ids("itemId"), items, "أحد الأصناف")) ??
    (await check(ids("warehouseId"), warehouses, "أحد المخازن"))
  );
}

/** Save the migration figures as a draft. Nothing hits the ledger until posted. */
export async function saveOpeningBalanceAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const date = new Date(d.date);
    if (Number.isNaN(date.getTime())) return { error: "التاريخ غير صالح" };

    const bad = validateOpening(d.lines as OpeningLine[]);
    if (bad) return { error: bad };
    const owned = await assertOwned(auth.orgId, d.lines as OpeningLine[]);
    if (owned) return { error: owned };

    // One opening balance per org — it states a single moment, and a second POSTED one
    // would double every balance it touches.
    const [posted] = await db.select({ id: openingBalances.id }).from(openingBalances)
      .where(and(eq(openingBalances.organizationId, auth.orgId), eq(openingBalances.status, "POSTED"))).limit(1);
    if (posted) return { error: "توجد أرصدة افتتاحية مُرحّلة بالفعل — لا يمكن ترحيل أكثر من واحدة" };

    try {
      const id = await db.transaction(async (tx) => {
        // Replace any existing draft rather than accumulate half-finished attempts.
        const existing = await tx.select({ id: openingBalances.id }).from(openingBalances)
          .where(and(eq(openingBalances.organizationId, auth.orgId), eq(openingBalances.status, "DRAFT")));
        if (existing.length) await tx.delete(openingBalances).where(inArray(openingBalances.id, existing.map((r) => r.id)));

        const [head] = await tx.insert(openingBalances).values({
          organizationId: auth.orgId, date, status: "DRAFT", notes: d.notes?.trim() || null,
        }).returning({ id: openingBalances.id });

        await tx.insert(openingBalanceLines).values(d.lines.map((l) => ({
          openingBalanceId: head.id, kind: l.kind,
          accountId: l.accountId || null, customerId: l.customerId || null,
          supplierId: l.supplierId || null, itemId: l.itemId || null, warehouseId: l.warehouseId || null,
          debit: String(round2(l.debit ?? 0)), credit: String(round2(l.credit ?? 0)),
          quantity: l.quantity != null ? String(l.quantity) : null,
          unitCost: l.unitCost != null ? String(l.unitCost) : null,
          notes: l.notes?.trim() || null,
        })));
        return head.id;
      });

      revalidatePath("/erp/settings/opening-balance");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ الأرصدة الافتتاحية" };
    }
  });
}

/**
 * Post the migration.
 *
 *   ACCOUNT  → straight to the GL account.
 *   CUSTOMER → Dr 1103 AND an opening invoice (status POSTED, balanceDue = amount,
 *              no lines) AND customers.balance. The invoice matters: aging and
 *              receipt vouchers both read salesInvoices, so a balance-only opening
 *              would be invisible to collections and impossible to settle. It posts
 *              no revenue of its own — that belongs to the old system; the AR debit
 *              comes from this entry.
 *   SUPPLIER → mirror against 2101 / purchaseInvoices / suppliers.balance.
 *   ITEM     → through postStockMovement, so the stock ledger and 1104 move together
 *              exactly as they do for a goods receipt.
 *
 * Everything balances against 3002.
 */
export async function postOpeningBalanceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [head] = await db.select().from(openingBalances)
      .where(and(eq(openingBalances.id, id), eq(openingBalances.organizationId, auth.orgId))).limit(1);
    if (!head) return { error: "الأرصدة الافتتاحية غير موجودة" };
    if (head.status !== "DRAFT") return { error: "مُرحّلة بالفعل" };

    const rows = await db.select().from(openingBalanceLines).where(eq(openingBalanceLines.openingBalanceId, id));
    const lines: OpeningLine[] = rows.map((r) => ({
      kind: r.kind as OpeningLine["kind"],
      accountId: r.accountId, customerId: r.customerId, supplierId: r.supplierId,
      itemId: r.itemId, warehouseId: r.warehouseId,
      debit: Number(r.debit), credit: Number(r.credit),
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unitCost: r.unitCost != null ? Number(r.unitCost) : null,
    }));

    const bad = validateOpening(lines);
    if (bad) return { error: bad };

    const needsAr = lines.some((l) => l.kind === "CUSTOMER");
    const needsAp = lines.some((l) => l.kind === "SUPPLIER");
    const needsInv = lines.some((l) => l.kind === "ITEM");

    // purchase_invoices.warehouse_id is NOT NULL, but an opening AP invoice carries no
    // lines so no warehouse is meaningful. Pick the lowest code — deterministic, unlike
    // a bare limit(1), which can return a different row run to run.
    let apWarehouse: string | null = null;
    if (needsAp) {
      const [w] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true)))
        .orderBy(warehouses.code).limit(1);
      if (!w) return { error: "أنشئ مخزنًا واحدًا على الأقل قبل ترحيل أرصدة الموردين" };
      apWarehouse = w.id;
    }
    const A = await resolveAccountIds(auth.orgId, ["1103", "2101", "1104"]);
    if (needsAr && !A["1103"]) return { error: "حساب العملاء (1103) غير موجود" };
    if (needsAp && !A["2101"]) return { error: "حساب الموردين (2101) غير موجود" };
    if (needsInv && !A["1104"]) return { error: "حساب المخزون (1104) غير موجود" };

    const date = new Date(head.date);
    const t = totals(lines);
    const year = date.getFullYear();

    try {
      await db.transaction(async (tx) => {
        // Claim first — the status check above is outside the transaction, and posting
        // this twice would double every opening balance in the company.
        const claimed = await tx.update(openingBalances).set({ status: "POSTED", updatedAt: new Date() })
          .where(and(eq(openingBalances.id, id), eq(openingBalances.status, "DRAFT")))
          .returning({ id: openingBalances.id });
        if (claimed.length === 0) throw new Error("ALREADY_POSTED");

        const openingAccount = await ensureOpeningAccount(auth.orgId, tx);
        const glLines: { accountId: string; debit: number; credit: number; description: string }[] = [];

        for (const l of lines) {
          const w = weigh(l);

          if (l.kind === "ACCOUNT") {
            glLines.push({ accountId: l.accountId!, debit: w.debit, credit: w.credit, description: "رصيد افتتاحي" });
          }

          if (l.kind === "CUSTOMER") {
            const number = await nextDocumentNumber(tx, auth.orgId, "SI", year);
            await tx.insert(salesInvoices).values({
              organizationId: auth.orgId, number, customerId: l.customerId!, date,
              dueDate: date, status: "POSTED",
              subtotal: String(w.debit), discountAmount: "0", taxAmount: "0", totalAmount: String(w.debit),
              paidAmount: "0", balanceDue: String(w.debit),
              notes: "رصيد افتتاحي — مُرحّل من النظام السابق",
            });
            await tx.update(customers).set({ balance: sql`${customers.balance} + ${w.debit}` })
              .where(eq(customers.id, l.customerId!));
            glLines.push({ accountId: A["1103"]!, debit: w.debit, credit: 0, description: `رصيد افتتاحي — ${number}` });
          }

          if (l.kind === "SUPPLIER") {
            const number = await nextDocumentNumber(tx, auth.orgId, "PI", year);
            await tx.insert(purchaseInvoices).values({
              organizationId: auth.orgId, number, supplierId: l.supplierId!, date,
              warehouseId: apWarehouse!, dueDate: date, status: "POSTED",
              subtotal: String(w.credit), discountAmount: "0", taxAmount: "0", totalAmount: String(w.credit),
              paidAmount: "0", balanceDue: String(w.credit),
              notes: "رصيد افتتاحي — مُرحّل من النظام السابق",
            });
            await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${w.credit}` })
              .where(eq(suppliers.id, l.supplierId!));
            glLines.push({ accountId: A["2101"]!, debit: 0, credit: w.credit, description: `رصيد افتتاحي — ${number}` });
          }

          if (l.kind === "ITEM") {
            const r = await postStockMovement(tx, {
              orgId: auth.orgId, itemId: l.itemId!, warehouseId: l.warehouseId!, type: "IN",
              quantity: Number(l.quantity), unitCost: Number(l.unitCost), date,
              referenceType: "OPENING_BALANCE", referenceId: id, reason: "رصيد افتتاحي",
            });
            glLines.push({ accountId: A["1104"]!, debit: round2(r.totalCost), credit: 0, description: "مخزون افتتاحي" });
          }
        }

        // 3002 takes whatever makes it balance.
        if (t.balancing > 0) glLines.push({ accountId: openingAccount, debit: 0, credit: t.balancing, description: "حساب الأرصدة الافتتاحية" });
        else if (t.balancing < 0) glLines.push({ accountId: openingAccount, debit: -t.balancing, credit: 0, description: "حساب الأرصدة الافتتاحية" });

        await postEntry(tx, {
          orgId: auth.orgId, userId: auth.userId,
          sourceType: "OPENING_BALANCE", sourceId: id, date,
          description: "الأرصدة الافتتاحية", journalType: "GENERAL",
          lines: glLines,
        });
      });

      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "OPENING_BALANCE", entityId: id, summary: `ترحيل الأرصدة الافتتاحية — مدين ${t.debit} / دائن ${t.credit}` });
      revalidatePath("/erp/settings/opening-balance");
      revalidatePath("/erp/accounting/journal");
      revalidatePath("/erp/inventory/stock");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "ALREADY_POSTED") return { error: "مُرحّلة بالفعل" };
      return { error: msg || "تعذّر ترحيل الأرصدة الافتتاحية" };
    }
  });
}
