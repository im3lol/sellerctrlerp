"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accounts, customers, suppliers, items, warehouses,
  openingBalances, openingBalanceLines, salesInvoices, purchaseInvoices,
  journalEntries, stockMovements, stockMovementBatches, stockBatches,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { totals, validateOpening, weigh, type OpeningLine } from "@/lib/erp/opening-balance";
import { round2 } from "@/lib/erp/money";
import { tryRecordAudit } from "@/lib/erp/audit";
import { itemCodes } from "@/db/schema";
import { parseCsv, detectHeaderRow } from "@/lib/erp/csv";
import { normalizeCode } from "@/lib/erp/amazon-import";

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
  reference: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بندًا واحدًا على الأقل"),
});

/** The opening-balance equity account — the other side of every opening line.
 *  Uses the org's configured account (openingEquityAccountId) when set, else the
 *  default 3002, created on first use. */
async function ensureOpeningAccount(orgId: string, tx: Tx): Promise<string> {
  const resolved = (await resolveAccountIds(orgId, ["3002"], tx))["3002"];
  if (resolved) return resolved;
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

    // Opening balances can be entered in stages (e.g. stock now, receivables later) —
    // each is its own DRAFT → POSTED document + journal, so a second post ADDS the new
    // figures rather than double-counting the first. (Re-entering the SAME item/party
    // is a user error, not something this guard can safely catch.)
    try {
      const id = await db.transaction(async (tx) => {
        // Replace any existing draft rather than accumulate half-finished attempts.
        const existing = await tx.select({ id: openingBalances.id }).from(openingBalances)
          .where(and(eq(openingBalances.organizationId, auth.orgId), eq(openingBalances.status, "DRAFT")));
        if (existing.length) await tx.delete(openingBalances).where(inArray(openingBalances.id, existing.map((r) => r.id)));

        const [head] = await tx.insert(openingBalances).values({
          organizationId: auth.orgId, date, status: "DRAFT", notes: d.notes?.trim() || null,
        }).returning({ id: openingBalances.id });

        const values = d.lines.map((l) => ({
          openingBalanceId: head.id, kind: l.kind,
          accountId: l.accountId || null, customerId: l.customerId || null,
          supplierId: l.supplierId || null, itemId: l.itemId || null, warehouseId: l.warehouseId || null,
          debit: String(round2(l.debit ?? 0)), credit: String(round2(l.credit ?? 0)),
          quantity: l.quantity != null ? String(l.quantity) : null,
          unitCost: l.unitCost != null ? String(l.unitCost) : null,
          reference: l.reference?.trim() || null,
          dueDate: l.dueDate ? new Date(l.dueDate) : null,
          notes: l.notes?.trim() || null,
        }));
        // Chunk the insert: a single 11k-row .values() overflows Postgres's 65k
        // parameter cap. 500 rows × ~13 cols stays well under it.
        for (let i = 0; i < values.length; i += 500) {
          await tx.insert(openingBalanceLines).values(values.slice(i, i + 500));
        }
        return head.id;
      });

      revalidatePath("/settings/opening-balance");
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
  return runOpeningPost(auth.orgId, auth.userId, id);
}

// ── Background post + live progress ──────────────────────────────────────────
// An 11k-item post runs for minutes; doing it in the request would time out and
// gives no progress. So the client saves the draft then starts a BACKGROUND job
// and polls openingPostStatusAction for a "X / Y" line. In-memory state — single
// Docker app instance, same pattern as the marketplace product sync.
type OpeningPostState = { phase: "running" | "done" | "error"; done: number; total: number; error?: string; at: number };
const openingPostJobs = new Map<string, OpeningPostState>();
const opKey = (orgId: string, id: string) => `${orgId}:${id}`;

/** Start the post in the background; returns at once with the total to expect. */
export async function startOpeningPostAction(id: string): Promise<ActionState & { total?: number }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;
  const key = opKey(auth.orgId, id);
  if (openingPostJobs.get(key)?.phase === "running") return { ok: true };
  const cnt = await withOrgScope(auth.orgId, false, () =>
    db.select({ n: sql<number>`count(*)` }).from(openingBalanceLines).where(eq(openingBalanceLines.openingBalanceId, id)));
  const total = Number(cnt[0]?.n ?? 0);
  if (total === 0) return { error: "لا توجد بنود للترحيل" };
  openingPostJobs.set(key, { phase: "running", done: 0, total, at: Date.now() });
  const orgId = auth.orgId, userId = auth.userId;
  void (async () => {
    try {
      const r = await runOpeningPost(orgId, userId, id, (done) => { const s = openingPostJobs.get(key); if (s) s.done = done; });
      openingPostJobs.set(key, r.ok ? { phase: "done", done: total, total, at: Date.now() } : { phase: "error", done: 0, total, error: r.error, at: Date.now() });
    } catch (e) {
      openingPostJobs.set(key, { phase: "error", done: 0, total, error: e instanceof Error ? e.message : "تعذّر الترحيل", at: Date.now() });
    }
  })();
  return { ok: true, total };
}

/** Poll the background post — the client shows a "done / total" progress line. */
export async function openingPostStatusAction(id: string): Promise<{ phase: "running" | "done" | "error" | "idle"; done: number; total: number; error?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return { phase: "idle", done: 0, total: 0 };
  const s = openingPostJobs.get(opKey(auth.orgId, id));
  if (!s) return { phase: "idle", done: 0, total: 0 };
  if (s.phase !== "running") { revalidatePath("/settings/opening-balance"); revalidatePath("/inventory/stock"); }
  return { phase: s.phase, done: s.done, total: s.total, error: s.error };
}

/** The post core — takes orgId/userId (so a background job can run it) and fires
 *  onProgress after each line so the caller can surface a live count. */
async function runOpeningPost(orgId: string, userId: string | null, id: string, onProgress?: (done: number) => void): Promise<ActionState> {
  return withOrgScope(orgId, false, async () => {
    const [head] = await db.select().from(openingBalances)
      .where(and(eq(openingBalances.id, id), eq(openingBalances.organizationId, orgId))).limit(1);
    if (!head) return { error: "الأرصدة الافتتاحية غير موجودة" };
    if (head.status !== "DRAFT") return { error: "مُرحّلة بالفعل" };

    const rows = await db.select().from(openingBalanceLines).where(eq(openingBalanceLines.openingBalanceId, id));
    const lines: (OpeningLine & { lineId: string })[] = rows.map((r) => ({
      lineId: r.id,
      kind: r.kind as OpeningLine["kind"],
      accountId: r.accountId, customerId: r.customerId, supplierId: r.supplierId,
      itemId: r.itemId, warehouseId: r.warehouseId,
      debit: Number(r.debit), credit: Number(r.credit),
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unitCost: r.unitCost != null ? Number(r.unitCost) : null,
      reference: r.reference, dueDate: r.dueDate ? r.dueDate.toISOString() : null,
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
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
        .orderBy(warehouses.code).limit(1);
      if (!w) return { error: "أنشئ مخزنًا واحدًا على الأقل قبل ترحيل أرصدة الموردين" };
      apWarehouse = w.id;
    }
    const A = await resolveAccountIds(orgId, ["1103", "2101", "1104"]);
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

        const openingAccount = await ensureOpeningAccount(orgId, tx);
        const glLines: { accountId: string; debit: number; credit: number; description: string }[] = [];
        let processed = 0;
        // Control accounts (AR/AP/inventory) are aggregated into ONE GL line each —
        // the per-party/per-item detail lives in the opening invoices + stock ledger,
        // and a line-per-row journal would (a) blow postEntry's param cap at 11k+ items
        // and (b) bloat the ledger with thousands of identical control-account lines.
        let arTotal = 0, apTotal = 0, stockTotal = 0;

        for (const l of lines) {
          const w = weigh(l);

          if (l.kind === "ACCOUNT") {
            glLines.push({ accountId: l.accountId!, debit: w.debit, credit: w.credit, description: "رصيد افتتاحي" });
          }

          if (l.kind === "CUSTOMER") {
            const number = await nextDocumentNumber(tx, orgId, "SI", year);
            const due = l.dueDate ? new Date(l.dueDate) : date;
            const [inv] = await tx.insert(salesInvoices).values({
              organizationId: orgId, number, customerId: l.customerId!, date,
              dueDate: due, status: "POSTED",
              subtotal: String(w.debit), discountAmount: "0", taxAmount: "0", totalAmount: String(w.debit),
              paidAmount: "0", balanceDue: String(w.debit),
              notes: `رصيد افتتاحي${l.reference ? ` — مرجع ${l.reference}` : ""} — مُرحّل من النظام السابق`,
            }).returning({ id: salesInvoices.id });
            await tx.update(openingBalanceLines).set({ postedRefId: inv.id }).where(eq(openingBalanceLines.id, l.lineId));
            await tx.update(customers).set({ balance: sql`${customers.balance} + ${w.debit}` })
              .where(eq(customers.id, l.customerId!));
            arTotal += w.debit;
          }

          if (l.kind === "SUPPLIER") {
            const number = await nextDocumentNumber(tx, orgId, "PI", year);
            const due = l.dueDate ? new Date(l.dueDate) : date;
            const [inv] = await tx.insert(purchaseInvoices).values({
              organizationId: orgId, number, supplierId: l.supplierId!, date,
              warehouseId: apWarehouse!, dueDate: due, status: "POSTED",
              subtotal: String(w.credit), discountAmount: "0", taxAmount: "0", totalAmount: String(w.credit),
              paidAmount: "0", balanceDue: String(w.credit),
              notes: `رصيد افتتاحي${l.reference ? ` — مرجع ${l.reference}` : ""} — مُرحّل من النظام السابق`,
            }).returning({ id: purchaseInvoices.id });
            await tx.update(openingBalanceLines).set({ postedRefId: inv.id }).where(eq(openingBalanceLines.id, l.lineId));
            await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${w.credit}` })
              .where(eq(suppliers.id, l.supplierId!));
            apTotal += w.credit;
          }

          if (l.kind === "ITEM") {
            const r = await postStockMovement(tx, {
              orgId, itemId: l.itemId!, warehouseId: l.warehouseId!, type: "IN",
              quantity: Number(l.quantity), unitCost: Number(l.unitCost), date,
              referenceType: "OPENING_BALANCE", referenceId: id, reason: "رصيد افتتاحي",
            });
            stockTotal += r.totalCost;
          }

          // Report progress every 25 lines (and let the event loop serve status polls).
          if (++processed % 25 === 0) { onProgress?.(processed); await Promise.resolve(); }
        }
        onProgress?.(processed);

        // One aggregated line per control account (keeps the journal small).
        if (arTotal > 0) glLines.push({ accountId: A["1103"]!, debit: round2(arTotal), credit: 0, description: "أرصدة العملاء الافتتاحية" });
        if (apTotal > 0) glLines.push({ accountId: A["2101"]!, debit: 0, credit: round2(apTotal), description: "أرصدة الموردين الافتتاحية" });
        if (stockTotal > 0) glLines.push({ accountId: A["1104"]!, debit: round2(stockTotal), credit: 0, description: "المخزون الافتتاحي" });

        // 3002 takes whatever makes it balance.
        if (t.balancing > 0) glLines.push({ accountId: openingAccount, debit: 0, credit: t.balancing, description: "حساب الأرصدة الافتتاحية" });
        else if (t.balancing < 0) glLines.push({ accountId: openingAccount, debit: -t.balancing, credit: 0, description: "حساب الأرصدة الافتتاحية" });

        await postEntry(tx, {
          orgId, userId,
          sourceType: "OPENING_BALANCE", sourceId: id, date,
          description: "الأرصدة الافتتاحية", journalType: "GENERAL",
          lines: glLines,
        });
      });

      await tryRecordAudit({ orgId, userId, action: "POST", entityType: "OPENING_BALANCE", entityId: id, summary: `ترحيل الأرصدة الافتتاحية — مدين ${t.debit} / دائن ${t.credit}` });
      revalidatePath("/settings/opening-balance");
      revalidatePath("/accounting/journal");
      revalidatePath("/inventory/stock");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "ALREADY_POSTED") return { error: "مُرحّلة بالفعل" };
      return { error: msg || "تعذّر ترحيل الأرصدة الافتتاحية" };
    }
  });
}

/**
 * Reverse a POSTED opening balance so it can be corrected, then re-open it as DRAFT.
 * ONLY allowed before any real activity touched the openings: every opening invoice
 * still fully outstanding, every opening stock layer untouched. Otherwise blocks and
 * the fix must be a manual journal entry. Reverses the GL (reverseEntry), cancels the
 * opening invoices (+ un-bumps party balances), and depletes the opening stock.
 */
export async function reverseOpeningBalanceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.reverse");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [head] = await db.select().from(openingBalances)
      .where(and(eq(openingBalances.id, id), eq(openingBalances.organizationId, auth.orgId))).limit(1);
    if (!head) return { error: "الأرصدة الافتتاحية غير موجودة" };
    if (head.status !== "POSTED") return { error: "لا يمكن عكس رصيد غير مُرحّل" };

    const rows = await db.select().from(openingBalanceLines).where(eq(openingBalanceLines.openingBalanceId, id));

    // Guard 1 — every opening invoice must be still fully outstanding (nothing settled).
    const siIds = rows.filter((r) => r.kind === "CUSTOMER" && r.postedRefId).map((r) => r.postedRefId!) as string[];
    const piIds = rows.filter((r) => r.kind === "SUPPLIER" && r.postedRefId).map((r) => r.postedRefId!) as string[];
    if (siIds.length) {
      const inv = await db.select({ paid: salesInvoices.paidAmount, status: salesInvoices.status }).from(salesInvoices)
        .where(and(eq(salesInvoices.organizationId, auth.orgId), inArray(salesInvoices.id, siIds)));
      if (inv.some((i) => Number(i.paid) > 0 || i.status !== "POSTED")) return { error: "تم تحصيل جزء من أرصدة العملاء الافتتاحية — التصحيح يكون بقيد يدوي" };
    }
    if (piIds.length) {
      const inv = await db.select({ paid: purchaseInvoices.paidAmount, status: purchaseInvoices.status }).from(purchaseInvoices)
        .where(and(eq(purchaseInvoices.organizationId, auth.orgId), inArray(purchaseInvoices.id, piIds)));
      if (inv.some((i) => Number(i.paid) > 0 || i.status !== "POSTED")) return { error: "تم سداد جزء من أرصدة الموردين الافتتاحية — التصحيح يكون بقيد يدوي" };
    }

    // Guard 2 — every opening stock layer must be untouched (remaining == opening qty).
    const moves = await db.select({ id: stockMovements.id, itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, quantity: stockMovements.quantity })
      .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "OPENING_BALANCE"), eq(stockMovements.referenceId, id)));
    for (const m of moves) {
      const smb = await db.select({ remaining: stockBatches.remainingQuantity, qty: stockMovementBatches.quantity })
        .from(stockMovementBatches)
        .innerJoin(stockBatches, eq(stockBatches.id, stockMovementBatches.batchId))
        .where(eq(stockMovementBatches.movementId, m.id));
      if (smb.some((s) => Math.abs(Number(s.remaining) - Number(s.qty)) > 1e-6)) {
        return { error: "تم استهلاك جزء من المخزون الافتتاحي — التصحيح يكون بقيد يدوي" };
      }
    }

    const date = new Date();
    try {
      await db.transaction(async (tx) => {
        // GL: reverse the whole opening journal (1103/2101/1104/3002 in one contra entry).
        const [je] = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "OPENING_BALANCE"), eq(journalEntries.sourceId, id))).limit(1);
        if (je) {
          await reverseEntry(tx, { orgId: auth.orgId, entryId: je.id, date, userId: auth.userId, reason: "عكس الأرصدة الافتتاحية" });
          // Free the (org, OPENING_BALANCE, id) slot so a re-post doesn't collide with
          // the now-reversed original on the source unique index.
          await tx.update(journalEntries).set({ sourceId: `${id}#${je.id}` }).where(eq(journalEntries.id, je.id));
        }

        // AR/AP: cancel each opening invoice and un-bump the party balance.
        for (const r of rows) {
          if (r.kind === "CUSTOMER" && r.postedRefId) {
            await tx.update(salesInvoices).set({ status: "CANCELLED", balanceDue: "0" }).where(eq(salesInvoices.id, r.postedRefId));
            await tx.update(customers).set({ balance: sql`${customers.balance} - ${Number(r.debit)}` }).where(eq(customers.id, r.customerId!));
          }
          if (r.kind === "SUPPLIER" && r.postedRefId) {
            await tx.update(purchaseInvoices).set({ status: "CANCELLED", balanceDue: "0" }).where(eq(purchaseInvoices.id, r.postedRefId));
            await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${Number(r.credit)}` }).where(eq(suppliers.id, r.supplierId!));
          }
        }

        // Stock: deplete each opening layer (FIFO OUT consumes the untouched opening lot).
        // GL is already handled by reverseEntry, so this only moves the stock ledger.
        for (const m of moves) {
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId!, type: "OUT",
            quantity: Number(m.quantity), date, referenceType: "OPENING_BALANCE_REVERSE", referenceId: id, reason: "عكس مخزون افتتاحي",
          });
        }

        // Re-tag the original opening stock movements so a future reversal (after a
        // re-post) doesn't pick these already-reversed ones up again.
        if (moves.length) {
          await tx.update(stockMovements).set({ referenceType: "OPENING_BALANCE_REVERSED" })
            .where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "OPENING_BALANCE"), eq(stockMovements.referenceId, id)));
        }

        // Re-open for editing; clear the stale invoice links.
        await tx.update(openingBalances).set({ status: "DRAFT", updatedAt: new Date() }).where(eq(openingBalances.id, id));
        await tx.update(openingBalanceLines).set({ postedRefId: null }).where(eq(openingBalanceLines.openingBalanceId, id));
      });

      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "OPENING_BALANCE", entityId: id, summary: "عكس الأرصدة الافتتاحية — أُعيدت مسودة للتعديل" });
      revalidatePath("/settings/opening-balance");
      revalidatePath("/accounting/journal");
      revalidatePath("/inventory/stock");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر عكس الأرصدة الافتتاحية" };
    }
  });
}

// Not exported — "use server" files must not re-export types (breaks the prod build).
// The client derives this via Awaited<ReturnType<typeof parseOpeningCsvAction>>.
type OpeningCsvRow = {
  kind: OpeningLine["kind"];
  code: string; name: string | null; refId: string | null;
  debit: number; credit: number;                                   // ACCOUNT
  amount: number; reference: string; dueDate: string;              // CUSTOMER/SUPPLIER
  warehouse: string; warehouseId: string | null; quantity: number; unitCost: number; // ITEM
  error: string | null;
};

/**
 * Parse an opening-balance CSV for any section and match each row to a catalog
 * record. Returns a preview — the client shows matched/unmatched and merges only the
 * matched rows into the draft. Columns per kind:
 *   ACCOUNT           → كود الحساب · مدين · دائن
 *   CUSTOMER/SUPPLIER → كود الطرف · رقم الفاتورة · تاريخ الاستحقاق · المبلغ
 *   ITEM              → الكود/SKU · المخزن · الكمية · التكلفة
 */
export async function parseOpeningCsvAction(kind: OpeningLine["kind"], csvText: string): Promise<OpeningCsvRow[]> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return [];
  return withOrgScope(auth.orgId, false, async () => {
    let rows = parseCsv(csvText);
    if (rows.length === 0) return [];
    const h = detectHeaderRow(rows);
    if (h >= 0) rows = rows.slice(h + 1);
    const base = (): OpeningCsvRow => ({ kind, code: "", name: null, refId: null, debit: 0, credit: 0, amount: 0, reference: "", dueDate: "", warehouse: "", warehouseId: null, quantity: 0, unitCost: 0, error: null });

    if (kind === "ITEM") {
      const [itemRows, codeRows, whRows] = await Promise.all([
        db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items).where(eq(items.organizationId, auth.orgId)),
        db.select({ itemId: itemCodes.itemId, norm: itemCodes.normalizedCode }).from(itemCodes).where(eq(itemCodes.organizationId, auth.orgId)),
        db.select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr }).from(warehouses).where(eq(warehouses.organizationId, auth.orgId)),
      ]);
      const nameById = new Map(itemRows.map((r) => [r.id, r.nameAr]));
      const itemByNorm = new Map<string, string>();
      for (const r of itemRows) itemByNorm.set(normalizeCode(r.code), r.id);
      for (const r of codeRows) if (r.norm && !itemByNorm.has(r.norm)) itemByNorm.set(r.norm, r.itemId);
      const whByKey = new Map<string, string>();
      for (const w of whRows) { whByKey.set(normalizeCode(w.code), w.id); if (w.nameAr) whByKey.set(w.nameAr.trim(), w.id); }
      return rows.map((cols) => {
        const r = base();
        r.code = (cols[0] ?? "").trim(); r.warehouse = (cols[1] ?? "").trim();
        r.quantity = Math.trunc(Number(cols[2] ?? 0)) || 0; r.unitCost = round2(Number(cols[3] ?? 0)) || 0;
        r.refId = itemByNorm.get(normalizeCode(r.code)) ?? null;
        r.name = r.refId ? nameById.get(r.refId) ?? null : null;
        r.warehouseId = whByKey.get(normalizeCode(r.warehouse)) ?? whByKey.get(r.warehouse) ?? null;
        if (!r.code) r.error = "بدون كود";
        else if (!r.refId) r.error = "الصنف غير موجود";
        else if (!r.warehouseId) r.error = "المخزن غير موجود";
        else if (!(r.quantity > 0)) r.error = "كمية غير صالحة";
        else if (!(r.unitCost > 0)) r.error = "تكلفة غير صالحة";
        return r;
      });
    }

    if (kind === "ACCOUNT") {
      const accs = await db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, auth.orgId), eq(accounts.isLeaf, true)));
      const byCode = new Map(accs.map((a) => [normalizeCode(a.code), { id: a.id, name: a.nameAr }]));
      return rows.map((cols) => {
        const r = base();
        r.code = (cols[0] ?? "").trim(); r.debit = round2(Number(cols[1] ?? 0)) || 0; r.credit = round2(Number(cols[2] ?? 0)) || 0;
        const m = byCode.get(normalizeCode(r.code));
        r.refId = m?.id ?? null; r.name = m?.name ?? null;
        if (!r.code) r.error = "بدون كود";
        else if (!r.refId) r.error = "الحساب غير موجود";
        else if (r.debit > 0 && r.credit > 0) r.error = "مدين ودائن معًا";
        else if (r.debit <= 0 && r.credit <= 0) r.error = "بدون مبلغ";
        return r;
      });
    }

    // CUSTOMER / SUPPLIER
    const table = kind === "CUSTOMER" ? customers : suppliers;
    const parties = await db.select({ id: table.id, code: table.code, nameAr: table.nameAr }).from(table).where(eq(table.organizationId, auth.orgId));
    const byKey = new Map<string, { id: string; name: string | null }>();
    for (const p of parties) { byKey.set(normalizeCode(p.code), { id: p.id, name: p.nameAr }); if (p.nameAr) byKey.set(p.nameAr.trim().toLowerCase(), { id: p.id, name: p.nameAr }); }
    return rows.map((cols) => {
      const r = base();
      r.code = (cols[0] ?? "").trim(); r.reference = (cols[1] ?? "").trim();
      const dd = (cols[2] ?? "").trim(); const parsed = dd ? new Date(dd) : null;
      r.dueDate = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
      r.amount = round2(Number(cols[3] ?? 0)) || 0;
      const m = byKey.get(normalizeCode(r.code)) ?? byKey.get(r.code.toLowerCase());
      r.refId = m?.id ?? null; r.name = m?.name ?? null;
      if (!r.code) r.error = "بدون كود";
      else if (!r.refId) r.error = kind === "CUSTOMER" ? "العميل غير موجود" : "المورّد غير موجود";
      else if (!(r.amount > 0)) r.error = "مبلغ غير صالح";
      return r;
    });
  });
}

/** Server-side item search for the opening-stock picker (the catalog is far bigger
 *  than a client-side list can hold). Matches code or Arabic name. */
export async function searchItemsAction(q: string): Promise<{ id: string; code: string; nameAr: string | null }[]> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return [];
  const term = q.trim();
  if (term.length < 1) return [];
  return withOrgScope(auth.orgId, false, () =>
    db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, auth.orgId), eq(items.isActive, true),
        or(ilike(items.code, `%${term}%`), ilike(items.nameAr, `%${term}%`))))
      .limit(30));
}
