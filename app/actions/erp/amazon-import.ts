"use server";

import { revalidatePath } from "next/cache";
import { authorizeErp } from "@/lib/erp/action-auth";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { parseAmazonWorkbook, groupAmazonOrders } from "@/lib/erp/amazon-import";
import { amazonOrdersToDto } from "@/lib/erp/marketplace/amazon/mappers";
import { previewOrders, ingestOrders, type OrdersPreview, type IngestResult, type PlatformCtx } from "@/lib/erp/marketplace/ingest";
import type { MarketplaceOrder } from "@/lib/erp/marketplace/dto";

const CHANNEL = "AMAZON";
const LABEL = "طلب أمازون";

export type AmazonPreview =
  | ({ ok: true; cancelledCount: number; zeroQtyCount: number } & OrdersPreview)
  | { ok: false; error: string };
export type ImportResult = ({ ok: true } & IngestResult) | { ok: false; error: string };

async function readOrders(formData: FormData): Promise<{ orders: MarketplaceOrder[]; cancelledCount: number; zeroQtyCount: number } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ارفع ملف الطلبات أولاً" };
  try {
    const grouped = groupAmazonOrders(parseAmazonWorkbook(Buffer.from(await file.arrayBuffer())));
    return { orders: amazonOrdersToDto(grouped.orders), cancelledCount: grouped.cancelledCount, zeroQtyCount: grouped.zeroQtyCount };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
  }
}

/** Parse + match, returning what WOULD be imported — no writes. */
export async function previewAmazonImportAction(formData: FormData): Promise<AmazonPreview> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const preview = await previewOrders(auth.orgId, { channel: CHANNEL }, parsed.orders);
  return { ok: true, cancelledCount: parsed.cancelledCount, zeroQtyCount: parsed.zeroQtyCount, ...preview };
}

/** Parse + match + create/fulfil each eligible order (see ingestOrders). */
export async function runAmazonImportAction(formData: FormData): Promise<ImportResult> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { platformId, customerId, warehouseId } = await ensureAmazonPlatform(auth.orgId);
  const ctx: PlatformCtx = { platformId, customerId, warehouseId, channel: CHANNEL, label: LABEL };
  const result = await ingestOrders(auth.orgId, auth.userId, ctx, parsed.orders);

  revalidatePath("/erp/sales/orders");
  revalidatePath("/erp/accounting");
  return { ok: true, ...result };
}
