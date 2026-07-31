import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, customers, suppliers, items, warehouses, openingBalances, openingBalanceLines, salesPlatforms, platformCredentials } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { OpeningBalanceEditor } from "@/components/erp/opening-balance-editor";

/**
 * Where a company that already exists gets onto the product: what it owed, was owed,
 * held in stock and had in the bank the day before go-live.
 *
 * Until this existed the only way in was hand-writing journal entries and faking
 * stock adjustments, which is why onboarding stalled for every real customer.
 */
export default async function OpeningBalancePage() {
  return loadErpPage("accounting.create", async ({ orgId }) => {
    // Accounts/customers/suppliers stay client-side (bounded); items are searched
    // server-side (the catalog can be tens of thousands of rows).
    const [allOb, accs, custs, supps, whs] = await Promise.all([
      db.select().from(openingBalances).where(eq(openingBalances.organizationId, orgId)).orderBy(desc(openingBalances.createdAt)),
      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true))).orderBy(asc(accounts.code)),
      db.select({ id: customers.id, code: customers.code, nameAr: customers.nameAr }).from(customers)
        .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ id: suppliers.id, code: suppliers.code, nameAr: suppliers.nameAr }).from(suppliers)
        .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
    ]);

    // A connected marketplace (has stored credentials) enables "pull opening stock
    // from Amazon". First one wins — the common case is a single Amazon account.
    const [connectedMkt] = await db.select({ code: salesPlatforms.code }).from(salesPlatforms)
      .innerJoin(platformCredentials, eq(platformCredentials.platformId, salesPlatforms.id))
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.isActive, true)))
      .orderBy(asc(salesPlatforms.code)).limit(1);
    const amazonCode = connectedMkt?.code.toLowerCase();

    // The editor edits the single open DRAFT; POSTED ones are shown as reversible
    // history so more sections can be added and posted separately over time.
    const draft = allOb.find((o) => o.status === "DRAFT") ?? null;
    const posted = allOb.filter((o) => o.status === "POSTED");
    const savedLines = draft
      ? await db.select().from(openingBalanceLines).where(eq(openingBalanceLines.openingBalanceId, draft.id))
      : [];

    // Resolve labels only for the items actually referenced by saved lines.
    const itemIds = [...new Set(savedLines.map((l) => l.itemId).filter(Boolean) as string[])];
    const itms = itemIds.length
      ? await db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items)
          .where(and(eq(items.organizationId, orgId), inArray(items.id, itemIds)))
      : [];

    const label = (code: string, name: string | null) => `${code} — ${name ?? ""}`.trim();
    const accOpts = accs.map((a) => ({ id: a.id, label: label(a.code, a.nameAr) }));
    const custOpts = custs.map((c) => ({ id: c.id, label: label(c.code, c.nameAr) }));
    const suppOpts = supps.map((s) => ({ id: s.id, label: label(s.code, s.nameAr) }));
    const whOpts = whs.map((w) => ({ id: w.id, label: label(w.code, w.nameAr) }));

    const byId = new Map([...accOpts, ...custOpts, ...suppOpts, ...itms.map((i) => ({ id: i.id, label: label(i.code, i.nameAr) }))].map((o) => [o.id, o.label]));
    const whById = new Map(whOpts.map((o) => [o.id, o.label]));

    const initial = savedLines.map((l) => {
      const ref = l.accountId ?? l.customerId ?? l.supplierId ?? l.itemId ?? "";
      return {
        kind: l.kind as "ACCOUNT" | "CUSTOMER" | "SUPPLIER" | "ITEM",
        ref,
        refLabel: byId.get(ref) ?? "",
        warehouseId: l.warehouseId ?? "",
        warehouseLabel: l.warehouseId ? whById.get(l.warehouseId) ?? "" : "",
        debit: Number(l.debit) ? String(Number(l.debit)) : "",
        credit: Number(l.credit) ? String(Number(l.credit)) : "",
        quantity: l.quantity != null ? String(Number(l.quantity)) : "",
        unitCost: l.unitCost != null ? String(Number(l.unitCost)) : "",
        reference: l.reference ?? "",
        dueDate: l.dueDate ? new Date(l.dueDate).toISOString().slice(0, 10) : "",
      };
    });

    // Default to the first day of the current fiscal year — the professional convention.
    const now = new Date();
    const fyStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const date = (draft ?? posted[0]) ? new Date((draft ?? posted[0]).date).toISOString().slice(0, 10) : fyStart.toISOString().slice(0, 10);

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="Upload" title="الأرصدة الافتتاحية"
          subtitle="أرصدة الحسابات والعملاء والموردين والمخزون كما كانت في بداية السنة المالية" backHref="/settings" />

        {custs.length + supps.length + itms.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              سجّل العملاء والموردين والأصناف أولاً (أو استوردهم من «الاستيراد والتصدير») ثم أدخل أرصدتهم الافتتاحية هنا.
            </CardContent>
          </Card>
        )}

        <OpeningBalanceEditor
          posted={posted.map((o) => ({ id: o.id, date: new Date(o.date).toISOString().slice(0, 10) }))}
          date={date}
          initial={initial}
          accounts={accOpts}
          customers={custOpts}
          suppliers={suppOpts}
          warehouses={whOpts}
          amazonCode={amazonCode}
        />
      </div>
    );
  });
}
