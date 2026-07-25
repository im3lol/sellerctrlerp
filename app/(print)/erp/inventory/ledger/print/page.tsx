import { loadErpPage } from "@/lib/erp/org";
import { getStockLedger, MOVE_TYPE, MOVE_REF } from "@/lib/erp/stock-ledger";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, qty, dt } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const sdt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PrintStockLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const sp = await searchParams;
    const itemId = one(sp.item);
    const fWarehouse = one(sp.warehouse);
    const fType = one(sp.type);
    const from = one(sp.from);
    const to = one(sp.to);

    const [{ org }, ledger] = await Promise.all([
      loadPrintHeader(orgId),
      getStockLedger(orgId, { itemId, warehouse: fWarehouse, type: fType, from, to }),
    ]);
    const { rows: all, totals, itemLabel, warehouses: whList } = ledger;
    const rows = all.slice(0, CAP);

    const backQs = new URLSearchParams();
    if (itemId) backQs.set("item", itemId);
    if (fWarehouse) backQs.set("warehouse", fWarehouse);
    if (fType) backQs.set("type", fType);
    if (from) backQs.set("from", from);
    if (to) backQs.set("to", to);

    const period = from || to
      ? [from && `من ${dt(from)}`, to && `إلى ${dt(to)}`].filter(Boolean).join(" ")
      : undefined;

    return (
      <ReportSheet
        org={org}
        title="دفتر حركة المخزون"
        period={period}
        backHref={`/inventory/ledger${backQs.size ? `?${backQs}` : ""}`}
        filters={[
          ...(itemLabel ? [{ label: "الصنف", value: itemLabel }] : []),
          ...(fWarehouse ? [{ label: "المستودع", value: whList.find((w) => w.id === fWarehouse)?.nameAr ?? "" }] : []),
          ...(fType ? [{ label: "النوع", value: MOVE_TYPE[fType]?.label ?? fType }] : []),
        ]}
        sections={[{
          columns: [
            { label: "التاريخ", width: "9%" },
            { label: "الصنف", width: "20%" },
            { label: "الحركة", width: "7%" },
            { label: "المستند", width: "13%" },
            { label: "المستودع", width: "9%" },
            { label: "وارد", align: "end", width: "7%" },
            { label: "منصرف", align: "end", width: "7%" },
            { label: "التكلفة", align: "end", width: "8%" },
            { label: "رصيد الكمية", align: "end", width: "9%" },
            { label: "قيمة الرصيد", align: "end", width: "11%" },
          ],
          rows: rows.map((r) => {
            const isOut = r.type === "OUT";
            return [
              sdt(r.date),
              <span key="n">
                <span dir="ltr" style={{ display: "block", textAlign: "start" }}>{r.itemName}</span>
                <span dir="ltr" style={{ color: "#8a93a6", fontSize: 9.5 }}>{r.itemCode}</span>
              </span>,
              MOVE_TYPE[r.type]?.label ?? r.type,
              <span key="d">
                {MOVE_REF[r.refType ?? ""] ?? r.reason ?? "—"}
                {r.refNumber && <span dir="ltr" style={{ display: "block", color: "#8a93a6", fontSize: 9.5 }}>{r.refNumber}</span>}
              </span>,
              r.warehouse ?? "—",
              !isOut ? qty(r.quantity) : "—",
              isOut ? qty(r.quantity) : "—",
              fmt(r.unitCost),
              qty(r.balanceQuantity),
              fmt(r.balanceValue),
            ];
          }),
          footerRow: [
            `الإجمالي (صافي ${qty(totals.net)}${totals.adjNet !== 0 ? ` — تسويات ${totals.adjNet > 0 ? "+" : ""}${qty(totals.adjNet)}` : ""})`,
            "", "", "", "",
            qty(totals.inQty),
            qty(totals.outQty),
            "", "", "",
          ],
        }]}
        note={all.length > CAP ? `عُرضت أول ${CAP.toLocaleString("ar-EG-u-nu-latn")} صف من ${all.length.toLocaleString("ar-EG-u-nu-latn")}.` : null}
      />
    );
  });
}
