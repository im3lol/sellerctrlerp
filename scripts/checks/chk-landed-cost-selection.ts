/** Real document-cycle tests. Fixtures are permitted ONLY in a disposable clone. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.startsWith("/sellerctrl_landed_test_")) throw new Error("Refusing landed-cost fixtures outside the isolated test database");
  const { db, pool } = await import("@/lib/db");
  const S = await import("@/db/schema");
  const { withPlatformScope, withOrgScope } = await import("@/lib/db-scope");
  const { runWithErpContext } = await import("@/lib/erp/erp-context");
  const { initializeAccountingForOrg } = await import("@/lib/erp/default-chart");
  const { postStockMovement } = await import("@/lib/erp/inventory");
  const { postEntry } = await import("@/lib/erp/posting");
  const { landedLineKey } = await import("@/lib/erp/landed-cost");
  const actions = await import("@/app/actions/erp/landed-costs");
  let checks = 0;
  const check = (ok: boolean, name: string) => { if (!ok) throw new Error(`FAIL ${name}`); checks++; console.log(`PASS ${name}`); };
  const date = new Date(), suffix = randomUUID().slice(0, 8);
  try {
    const fixture = await withPlatformScope(async () => {
      const [user] = await db.insert(S.users).values({ name: "LCV QA", email: `lcv-${suffix}@example.invalid`, username: `lcv_qa_${suffix}`, passwordHash: "disabled-test-login", role: "employee" }).returning();
      const [org] = await db.insert(S.organizations).values({ nameAr: "LCV isolated test", slug: `lcv-test-${suffix}` }).returning();
      const [foreign] = await db.insert(S.organizations).values({ nameAr: "LCV other company", slug: `lcv-other-${suffix}` }).returning();
      await db.insert(S.organizationMembers).values({ organizationId: org.id, userId: user.id, role: "admin" });
      await db.insert(S.orgSubscriptions).values({ organizationId: org.id, status: "ACTIVE", planName: "LCV QA", enabledModules: ["purchases", "inventory", "accounting"], expiresAt: new Date(Date.now() + 86400_000) });
      return { user, org, foreign };
    });
    const orgId = fixture.org.id;
    const context = { orgId, userId: fixture.user.id, role: "system_admin", permissions: new Set(["purchases.view", "purchases.create", "purchases.confirm"]) };
    const asUser = <T>(fn: () => Promise<T>) => runWithErpContext(context, fn);
    const f = await withOrgScope(orgId, false, async () => {
      await initializeAccountingForOrg(orgId);
      const [wh] = await db.select().from(S.warehouses).where(eq(S.warehouses.organizationId, orgId));
      const [supplier] = await db.insert(S.suppliers).values({ organizationId: orgId, code: "FREIGHT", nameAr: "QA freight supplier" }).returning();
      const [a, b] = await db.insert(S.items).values([
        { organizationId: orgId, code: "LCV-A", nameAr: "QA selected item", weightKg: "1" },
        { organizationId: orgId, code: "LCV-B", nameAr: "QA excluded item", weightKg: "2" },
      ]).returning();
      const receipts = await db.insert(S.purchaseReceipts).values([1, 2].map(n => ({ organizationId: orgId, number: `GRN-QA-${n}`, date, status: "RECEIVED", supplierId: supplier.id, warehouseId: wh.id }))).returning();
      await db.insert(S.purchaseReceiptLines).values([
        { purchaseReceiptId: receipts[0].id, itemId: a.id, warehouseId: wh.id, quantity: "5" },
        { purchaseReceiptId: receipts[0].id, itemId: b.id, warehouseId: wh.id, quantity: "4" },
        { purchaseReceiptId: receipts[1].id, itemId: a.id, warehouseId: wh.id, quantity: "5" },
      ]);
      const accounts = await db.select().from(S.accounts).where(eq(S.accounts.organizationId, orgId));
      const A = Object.fromEntries(accounts.map(a => [a.code, a.id]));
      await db.transaction(async tx => {
        for (const [item, quantity] of [[a, 10], [b, 4]] as const) await postStockMovement(tx, { orgId, itemId: item.id, warehouseId: wh.id, type: "IN", quantity, unitCost: 100, date, referenceType: "QA" });
        await postEntry(tx, { orgId, date, sourceType: "QA_OPEN", sourceId: randomUUID(), description: "QA opening", lines: [{ accountId: A["1104"], debit: 1400, credit: 0 }, { accountId: A["3002"], debit: 0, credit: 1400 }] });
      });
      return { wh, supplier, a, b, receipts, A };
    });
    const basis = await asUser(() => actions.getLandedCostBasisAction(f.receipts.map(r => r.id)));
    check(basis.ok === true && basis.lines?.length === 3, "all receipt items load before selection");
    const first = basis.lines!.find(l => l.purchaseReceiptId === f.receipts[0].id && l.itemId === f.a.id)!;
    const second = basis.lines!.find(l => l.purchaseReceiptId === f.receipts[1].id)!;
    const payload = (line: typeof first, perUnit: number) => ({ supplierId: f.supplier.id, date: date.toISOString().slice(0, 10), method: "manual", receiptIds: [line.purchaseReceiptId], selection: [{ key: landedLineKey(line), perUnit }], shipping: 9999 });
    const created = await asUser(() => actions.createLandedCostVoucherAction(payload(first, 10)));
    if (!created.ok || !created.id) throw new Error(created.error ?? "create failed");
    const draftId = created.id;
    await withOrgScope(orgId, false, async () => {
      const lines = await db.select().from(S.landedCostVoucherLines).where(eq(S.landedCostVoucherLines.voucherId, draftId));
      const [v] = await db.select().from(S.landedCostVouchers).where(eq(S.landedCostVouchers.id, draftId));
      check(lines.length === 1 && lines[0].itemId === f.a.id && Number(v.totalAmount) === 50, "manual freight saves only selected items and ignores forged header total");
      const entries = await db.select().from(S.journalEntries).where(eq(S.journalEntries.sourceId, draftId));
      check(entries.length === 0, "saving a draft has no accounting effect");
    });
    const edit = await asUser(() => actions.updateLandedCostVoucherAction(draftId, payload(first, 12)));
    check(edit.ok === true, "a saved draft can be edited without creating another voucher");
    check(!(await asUser(() => actions.updateLandedCostVoucherAction(draftId, { ...payload(first, 99), expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }))).ok, "a stale editor cannot overwrite a changed draft");
    const posts = await Promise.all([asUser(() => actions.postLandedCostVoucherAction(draftId)), asUser(() => actions.postLandedCostVoucherAction(draftId))]);
    check(posts.filter(r => r.ok).length === 1, "concurrent posting applies a voucher exactly once");
    check(!(await asUser(() => actions.updateLandedCostVoucherAction(draftId, payload(first, 99)))).ok, "posted documents cannot be edited in place");
    const history = await asUser(() => actions.getLandedCostBasisAction([first.purchaseReceiptId]));
    check(history.lines?.length === 2 && history.lines.find(l => l.itemId === f.a.id)?.previousPerUnit === 12 && history.lines.find(l => l.itemId === f.b.id)?.previousPerUnit === 0, "reopening a receipt shows all items and their actual prior costs");
    const extra = await asUser(() => actions.createLandedCostVoucherAction(payload(second, 8)));
    if (!extra.id) throw new Error(extra.error);
    check((await asUser(() => actions.postLandedCostVoucherAction(extra.id!))).ok === true, "a separate receipt can carry a different additional cost");
    const assertBalanced = async (ap: number) => withOrgScope(orgId, false, async () => {
      const r = await db.execute<{ gl: string; stock: string; ap: string; diff: string }>(sql`
        SELECT (select coalesce(sum(l.debit-l.credit),0) from journal_entry_lines l join journal_entries j on j.id=l.journal_entry_id where j.organization_id=${orgId} and j.status='POSTED' and l.account_id=${f.A["1104"]}) gl,
        (select coalesce(sum(q.balance_value),0) from (select distinct on(item_id,warehouse_id) balance_value from stock_movements where organization_id=${orgId} order by item_id,warehouse_id,created_at desc,number desc) q) stock,
        (select balance from suppliers where id=${f.supplier.id}) ap,
        (select coalesce(sum(l.debit-l.credit),0) from journal_entry_lines l join journal_entries j on j.id=l.journal_entry_id where j.organization_id=${orgId} and j.status='POSTED') diff`);
      const v = r.rows[0];
      check(Math.abs(Number(v.gl) - Number(v.stock)) < 0.01 && Math.abs(Number(v.ap) - ap) < 0.01 && Math.abs(Number(v.diff)) < 0.01, `inventory/GL, supplier balance and double entry reconcile (AP ${ap})`);
    });
    await assertBalanced(100);
    await withOrgScope(orgId, false, () => db.transaction(async tx => {
      const move = await postStockMovement(tx, { orgId, itemId: f.a.id, warehouseId: f.wh.id, type: "OUT", quantity: 8, date, referenceType: "QA_SALE" });
      await postEntry(tx, { orgId, date, sourceType: "QA_SALE", sourceId: randomUUID(), description: "QA sold units", lines: [{ accountId: f.A["5101"], debit: move.totalCost, credit: 0 }, { accountId: f.A["1104"], debit: 0, credit: move.totalCost }] });
    }));
    check((await asUser(() => actions.cancelLandedCostVoucherAction(draftId))).ok === true, "reversal after a partial sale succeeds");
    await assertBalanced(40);
    await withOrgScope(orgId, false, () => db.update(S.fiscalPeriods).set({ status: "CLOSED" }).where(eq(S.fiscalPeriods.organizationId, orgId)));
    check(!(await asUser(() => actions.correctLandedCostVoucherAction(extra.id!))).ok, "a closed fiscal period blocks correction without a partial reversal");
    await assertBalanced(40);
    await withOrgScope(orgId, false, () => db.update(S.fiscalPeriods).set({ status: "OPEN" }).where(eq(S.fiscalPeriods.organizationId, orgId)));
    const corrected = await asUser(() => actions.correctLandedCostVoucherAction(extra.id!));
    check(corrected.ok === true && !!corrected.number, "posted correction reverses the old cost and creates one replacement draft");
    await assertBalanced(0);
    check(!(await asUser(() => actions.correctLandedCostVoucherAction(extra.id!))).ok, "a cancelled voucher cannot generate a duplicate correction");
    const [replacement] = await withOrgScope(orgId, false, () => db.select().from(S.landedCostVouchers).where(and(eq(S.landedCostVouchers.organizationId, orgId), eq(S.landedCostVouchers.number, corrected.number!))));
    check((await asUser(() => actions.updateLandedCostVoucherAction(replacement.id, payload(second, 6)))).ok === true, "replacement costs can be edited as a draft");
    check((await asUser(() => actions.postLandedCostVoucherAction(replacement.id))).ok === true, "only the corrected new cost is posted");
    await assertBalanced(30);
    const foreign = await runWithErpContext({ ...context, orgId: fixture.foreign.id }, () => actions.getLandedCostBasisAction([first.purchaseReceiptId]));
    check(!foreign.ok, "another company cannot load the receipt or its previous costs");
    const forged = await asUser(() => actions.createLandedCostVoucherAction({ ...payload(first, 10), selection: [{ key: `${randomUUID()}|${f.a.id}|${f.wh.id}`, perUnit: 10 }] }));
    check(!forged.ok, "forged receipt line selection is rejected");
    check(!(await runWithErpContext({ ...context, permissions: new Set(["purchases.view"]) }, () => actions.updateLandedCostVoucherAction(replacement.id, payload(second, 99)))).ok, "read-only access cannot change a cost voucher");
    console.log(`${checks} landed-cost integration checks passed. Fixtures stay only in ${url.pathname}.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
