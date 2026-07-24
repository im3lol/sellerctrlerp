import { loadErpPage } from "@/lib/erp/org";
import { getStockBalances } from "@/lib/erp/stock-balances";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, qty } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const sdt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const STATUS_AR: Record<string, string> = { OK: "متوفّر", LOW: "منخفض", OUT: "نافد" };

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PrintStockBalancePage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const sp = await searchParams;
    const fProduct = one(sp.product).trim();
    const fWarehouse = one(sp.warehouse);
    const fStatus = one(sp.status);

    const [{ org }, { lines: all, totals, warehouses: whList }] = await Promise.all([
      loadPrintHeader(orgId),
      getStockBalances(orgId, { product: fProduct, warehouse: fWarehouse, status: fStatus }),
    ]);
    const lines = all.slice(0, CAP);

    const backQs = new URLSearchParams();
    if (fProduct) backQs.set("product", fProduct);
    if (fWarehouse) backQs.set("warehouse", fWarehouse);
    if (fStatus) backQs.set("status", fStatus);

    return (
      <ReportSheet
        org={org}
        title="أرصدة المخزون"
        backHref={`/inventory/stock${backQs.size ? `?${backQs}` : ""}`}
        filters={[
          ...(fProduct ? [{ label: "المنتج", value: fProduct }] : []),
          ...(fWarehouse ? [{ label: "المستودع", value: whList.find((w) => w.id === fWarehouse)?.nameAr ?? "" }] : []),
          ...(fStatus ? [{ label: "الحالة", value: STATUS_AR[fStatus] ?? fStatus }] : []),
        ]}
        kpis={[
          { label: "قيمة المخزون", value: intl(Math.round(totals.value)) },
          { label: "إجمالي الكمية", value: qty(totals.quantity) },
          { label: "عدد الأصناف", value: intl(totals.items) },
          { label: "مخزون منخفض", value: intl(totals.low) },
          { label: "مخزون نافد", value: intl(totals.out), tone: "danger" },
        ]}
        sections={[{
          columns: [
            { label: "الكود", width: "10%" },
            { label: "الصنف", width: "30%" },
            { label: "المستودع", width: "12%" },
            { label: "الكمية", align: "end", width: "9%" },
            { label: "متوسط التكلفة", align: "end", width: "11%" },
            { label: "القيمة", align: "end", width: "11%" },
            { label: "أقرب انتهاء", width: "10%" },
            { label: "الحالة", width: "7%" },
          ],
          rows: lines.map((l) => [
            <span key="c" dir="ltr" style={{ display: "block", textAlign: "start" }}>{l.code}</span>,
            <span key="n" dir="ltr" style={{ display: "block", textAlign: "start" }}>{l.name}</span>,
            l.warehouse,
            qty(l.quantity),
            fmt(l.avgCost),
            fmt(l.value),
            l.nearestExpiry ? sdt(l.nearestExpiry) : "—",
            STATUS_AR[l.status] ?? l.status,
          ]),
          footerRow: ["الإجمالي (كل الصفوف)", "", "", qty(totals.quantity), "", fmt(totals.value), "", ""],
        }]}
        note={all.length > CAP ? `عُرضت أول ${intl(CAP)} صف من ${intl(all.length)}.` : null}
      />
    );
  });
}
