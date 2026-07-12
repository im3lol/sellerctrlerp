import { requireErpModule } from "@/lib/erp/org";
import { xlsxResponse } from "@/lib/erp/xlsx";
import { EXPORT_DATASETS } from "@/lib/erp/export-datasets";

export const runtime = "nodejs";

/** Generic Excel export for any registered dataset. Guarded by the dataset's module. */
export async function GET(_req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const key = (await params).dataset;
  const ds = EXPORT_DATASETS[key];
  if (!ds) return new Response("unknown dataset", { status: 404 });

  const { orgId } = await requireErpModule(ds.module);
  const rows = await ds.fetch(orgId);

  return xlsxResponse({ sheet: ds.title, filename: key, headers: ds.headers, rows, colWidths: ds.colWidths });
}
