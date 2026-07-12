import { notFound } from "next/navigation";
import { requireErpModule } from "@/lib/erp/org";
import { EXPORT_DATASETS, type Cell } from "@/lib/erp/export-datasets";
import { PrintNowButton } from "@/components/erp/print-now-button";

export const runtime = "nodejs";

const cell = (c: Cell) => (typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 2 }) : (c ?? ""));

/** Generic printable (→ PDF) view for any registered dataset. */
export default async function ExportPrintPage({ params }: { params: Promise<{ dataset: string }> }) {
  const key = (await params).dataset;
  const ds = EXPORT_DATASETS[key];
  if (!ds) notFound();

  const { orgId } = await requireErpModule(ds.module);
  const rows = await ds.fetch(orgId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-sm text-gray-500">اضغط «طباعة / حفظ PDF» ثم اختر «حفظ كـ PDF».</span>
        <PrintNowButton />
      </div>
      <h1 className="mb-1 text-xl font-bold">{ds.title}</h1>
      <p className="mb-4 text-sm text-gray-500">{today} — {rows.length} سجل</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {ds.headers.map((h, i) => (
              <th key={i} className="border border-gray-300 bg-gray-100 px-2 py-1 text-right font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border border-gray-300 px-2 py-1 text-right">{cell(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
