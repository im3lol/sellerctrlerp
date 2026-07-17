import { loadErpPage } from "@/lib/erp/org";
import { getStockBalances } from "@/lib/erp/stock-balances";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { accountBalances } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Reconcile the stock-ledger inventory value against the GL inventory account.
 *  They must be equal — a non-zero difference means a posting bug (the GL == ledger
 *  invariant). Read-only. */
export default async function InventoryValuationReconciliationPage() {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const [{ totals }, invMap, balances] = await Promise.all([
      getStockBalances(orgId, {}),
      resolveAccountIds(orgId, ["1104"]),
      accountBalances({ orgId }),
    ]);

    const ledgerValue = totals.value;
    const invAccountId = invMap["1104"];
    const invAccount = invAccountId ? balances.find((b) => b.id === invAccountId) : undefined;
    const glValue = invAccount?.balance ?? 0; // signed debit − credit (inventory is DEBIT-normal)
    const diff = glValue - ledgerValue;
    const matched = Math.abs(diff) < 0.01;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Scale" title="مطابقة قيمة المخزون" subtitle="قيمة دفتر المخزون مقابل حساب المخزون في الأستاذ العام" backHref="/erp/inventory" />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">قيمة دفتر المخزون</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(ledgerValue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">رصيد حساب المخزون (GL)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(glValue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">الفرق</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${matched ? "text-emerald-600" : "text-destructive"}`}>{fmt(diff)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>النتيجة</CardTitle>
              <CardDescription>
                {invAccount
                  ? `حساب المخزون: ${invAccount.code} — ${invAccount.nameAr}. القيمتان يجب أن تتطابقا؛ أي فرق يعني خطأً في الترحيل.`
                  : "لم يُضبط حساب المخزون (1104) في دليل الحسابات."}
              </CardDescription>
            </div>
            <Badge variant={matched ? "default" : "destructive"} className="text-sm">{matched ? "مطابَق" : "غير مطابَق"}</Badge>
          </CardHeader>
          <CardContent>
            {matched ? (
              <p className="text-sm text-muted-foreground">دفتر المخزون يطابق حساب الأستاذ العام تماماً.</p>
            ) : (
              <p className="text-sm text-destructive">
                يوجد فرق قدره {fmt(Math.abs(diff))}. راجِع القيود اليدوية على حساب المخزون أو حركات المخزون غير المُرحَّلة محاسبياً.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
