import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import type { ErpPermission } from "@/lib/erp/permissions";
import type { DocRow } from "@/lib/erp/mobile-lists";
import {
  quotationList, receiptVoucherList, paymentVoucherList, purchaseReceiptList,
  materialRequestList, stockAdjustmentList, stockTransferList, bankAccountList,
  fixedAssetList, chartAccountList, holidayList,
} from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** key → { permission, list fn }. One route serves every coverage-batch list. */
const REGISTRY: Record<string, { perm: ErpPermission; fn: (orgId: string) => Promise<DocRow[]> }> = {
  quotations: { perm: "sales.view", fn: quotationList },
  "sales-receipts": { perm: "sales.view", fn: receiptVoucherList },
  "purchase-payments": { perm: "purchases.view", fn: paymentVoucherList },
  "purchase-receipts": { perm: "purchases.view", fn: purchaseReceiptList },
  requisitions: { perm: "purchases.view", fn: materialRequestList },
  adjustments: { perm: "inventory.view", fn: stockAdjustmentList },
  transfers: { perm: "inventory.view", fn: stockTransferList },
  banks: { perm: "accounting.view", fn: bankAccountList },
  assets: { perm: "accounting.view", fn: fixedAssetList },
  chart: { perm: "accounting.view", fn: chartAccountList },
  holidays: { perm: "hr.view", fn: holidayList },
};

/** GET /api/v1/list/:key — dispatches to the registered list for that key. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const entry = REGISTRY[key];
  if (!entry) return Response.json({ error: "not_found" }, { status: 404 });
  const auth = await authorizeApi(req, entry.perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await entry.fn(auth.orgId) });
}
