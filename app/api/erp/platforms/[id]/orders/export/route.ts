import { and, desc, eq, or } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_DELIVERED: "تسليم جزئي",
  DELIVERED: "مُسلّم", INVOICED: "مفوتر", CANCELLED: "ملغى",
};

/** Excel export of a platform's sales orders. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireErpModule("sales.view");

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, orgId))).limit(1);
  if (!platform) return new Response("Not found", { status: 404 });

  const rows = await db
    .select({
      number: salesOrders.number, date: salesOrders.date, status: salesOrders.status,
      externalOrderId: salesOrders.externalOrderId, total: salesOrders.totalAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), or(eq(salesOrders.platformId, platform.id), eq(salesOrders.channel, platform.code))))
    .orderBy(desc(salesOrders.date), desc(salesOrders.number));

  const total = rows.reduce((s, r) => s + Number(r.total), 0);

  return xlsxResponse({
    sheet: `أوامر ${platform.name}`.slice(0, 31),
    filename: `orders-${platform.code}`,
    headers: ["الرقم", "التاريخ", "رقم الطلب الخارجي", "الإجمالي", "الحالة"],
    rows: rows.map((r) => [r.number, xlsxDate(r.date), r.externalOrderId ?? "", Number(r.total), STATUS[r.status] ?? r.status]),
    totalRow: ["الإجمالي", "", "", total, ""],
    colWidths: [16, 12, 24, 14, 12],
  });
}
