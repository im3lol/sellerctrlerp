import { and, asc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { warehouses, accounts, customers, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PosTerminal } from "@/components/erp/pos-terminal";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  return loadErpPage("sales.create", async ({ orgId }) => {
    const [whList, cashList, custList, org] = await Promise.all([
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr })
        .from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true), eq(warehouses.isQuarantine, false)))
        .orderBy(asc(warehouses.nameAr)),
      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
        .from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.code, ["1101", "1102"])))
        .orderBy(asc(accounts.code)),
      db.select({ id: customers.id, code: customers.code, nameAr: customers.nameAr })
        .from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.isActive, true)))
        .orderBy(asc(customers.code)).limit(1000),
      db.select({ vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);

    const missing = whList.length === 0 || cashList.length === 0 || custList.length === 0;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Store"
          title="نقطة البيع"
          subtitle="بيع سريع بالباركود — كل بيعة فاتورة مرحّلة وسند قبض"
          backHref="/sales"
        />

        {missing ? (
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              نقطة البيع محتاجة مخزن مفعّل، وحساب خزينة (١١٠١ أو ١١٠٢)، وعميل واحد على الأقل —
              اعمل «عميل نقدي» لو مش بتسجّل بيانات كل مشترٍ.
            </p>
          </CardContent></Card>
        ) : (
          <PosTerminal
            warehouses={whList.map((w) => ({ id: w.id, label: w.nameAr }))}
            cashAccounts={cashList.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
            customers={custList.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` }))}
            defaultCustomerId={custList[0]?.id ?? null}
            vatRate={Number(org[0]?.vatRate ?? 0)}
          />
        )}
      </div>
    );
  });
}
