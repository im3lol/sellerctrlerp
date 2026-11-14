import { authorizeErp } from "./action-auth";
import type { ExportDataset } from "./export-datasets";

/** Every read path (including saved reports) must check the dataset's cost policy. */
export async function authorizeExportDataset(dataset: ExportDataset) {
  const auth = await authorizeErp(dataset.module);
  if ("error" in auth || !dataset.purchaseCosts) return auth;
  const purchase = await authorizeErp("purchases.create");
  if (!("error" in purchase)) return auth;
  const accounting = await authorizeErp("accounting.view");
  return "error" in accounting ? { error: "ليس لديك صلاحية الاطلاع على تكاليف المشتريات" } : auth;
}
