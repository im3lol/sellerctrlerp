import { loadErpPage } from "@/lib/erp/org";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { getExpiryReport } from "@/lib/erp/expiry";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, qty } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const sdt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const STATUS_AR: Record<string, string> = { EXPIRED: "منتهي", NEAR: "قرب الانتهاء", OK: "سليم" };

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PrintExpiryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const sp = await searchParams;
    const fProduct = one(sp.product).trim();
    const fWarehouse = one(sp.warehouse);
    const fStatus = one(sp.status);
    const within = Math.max(1, parseInt(one(sp.within) || "30", 10) || 30);

    const [{ org }, { rows: all, totals, warehouses: whList, withinDays }] = await Promise.all([
      loadPrintHeader(orgId),
      getExpiryReport(orgId, { product: fProduct, warehouse: fWarehouse, status: fStatus, withinDays: within }),
    ]);
    const rows = all.slice(0, CAP);

    const backQs = new URLSearchParams();
    if (fProduct) backQs.set("product", fProduct);
    if (fWarehouse) backQs.set("warehouse", fWarehouse);
    if (fStatus) backQs.set("status", fStatus);
    if (one(sp.within)) backQs.set("within", one(sp.within));

    return (
      <ReportSheet
        org={org}
        title={t("تنبيهات انتهاء الصلاحية")}
        backHref={`/inventory/expiry${backQs.size ? `?${backQs}` : ""}`}
        filters={[
          ...(fProduct ? [{ label: "المنتج", value: fProduct }] : []),
          ...(fWarehouse ? [{ label: "المستودع", value: whList.find((w) => w.id === fWarehouse)?.nameAr ?? "" }] : []),
          ...(fStatus ? [{ label: "الحالة", value: STATUS_AR[fStatus] ?? fStatus }] : []),
          { label: "حد التنبيه", value: fill(t("{0} يوم"), [intl(withinDays)]) },
        ]}
        kpis={[
          { label: "منتهية", value: intl(totals.expiredCount), tone: "danger" },
          { label: "قيمة المنتهي", value: fmt(totals.expiredValue), tone: "danger" },
          { label: fill(t("قرب الانتهاء (≤{0} يوم)"), [intl(withinDays)]), value: intl(totals.nearCount) },
          { label: "قيمة قرب الانتهاء", value: fmt(totals.nearValue) },
        ]}
        sections={[{
          columns: [
            { label: "الصنف", width: "28%" },
            { label: "المستودع", width: "12%" },
            { label: "رقم التشغيلة", width: "11%" },
            { label: "تاريخ الصلاحية", width: "11%" },
            { label: "المتبقّي للانتهاء", width: "12%" },
            { label: "الكمية", align: "end", width: "8%" },
            { label: "القيمة", align: "end", width: "10%" },
            { label: "الحالة", width: "8%" },
          ],
          rows: rows.map((r) => [
            <span key="n">
              <span dir="ltr" style={{ display: "block", textAlign: "start" }}>{r.itemName}</span>
              <span dir="ltr" style={{ color: "#8a93a6", fontSize: 9.5 }}>{r.itemCode}</span>
            </span>,
            r.warehouse,
            r.batchNo ?? "—",
            sdt(r.expiryDate),
            r.daysLeft < 0 ? fill(t("انتهى منذ {0} يوم"), [intl(-r.daysLeft)]) : fill(t("{0} يوم"), [intl(r.daysLeft)]),
            qty(r.remaining),
            fmt(r.value),
            STATUS_AR[r.status] ?? r.status,
          ]),
        }]}
        note={all.length > CAP ? fill(t("عُرضت أول {0} صف من {1}."), [intl(CAP), intl(all.length)]) : null}
      />
    );
  });
}
