import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { xlsxResponse } from "@/lib/erp/xlsx";
import { EXPORT_DATASETS } from "@/lib/erp/export-datasets";

export const runtime = "nodejs";

/** Generic Excel export for any registered dataset. Guarded by the dataset's module. */
export async function GET(_req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const key = (await params).dataset;
  const ds = EXPORT_DATASETS[key];
  if (!ds) return new Response("unknown dataset", { status: 404 });

  const { orgId } = await requireErpModule(ds.module);
  // withOrgScope: dataset fetches must run on a tenant-scoped connection — on the
  // bare pool they'd return empty sheets once RLS is enforced in production.
  const rows = await withOrgScope(orgId, false, () => ds.fetch(orgId));

  return xlsxResponse({ sheet: ds.title, filename: key, headers: ds.headers, rows, colWidths: ds.colWidths });
}
