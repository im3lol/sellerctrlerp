import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { resolveOrgByApiKey, apiKeyFromRequest } from "@/lib/erp/api-keys";
import { round2 } from "@/lib/erp/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InLine = { item?: string; quantity?: number; unitPrice?: number; discountAmount?: number; taxAmount?: number };
type Body = { customer?: string; date?: string; notes?: string; lines?: InLine[] };

const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });

/** POST /api/v1/sales-orders — create a DRAFT sales order. customer + line items
 *  may be given by id or by code. Auth: Bearer <api key> / x-api-key. No GL/stock. */
export async function POST(req: Request) {
  const orgId = await resolveOrgByApiKey(apiKeyFromRequest(req));
  if (!orgId) return bad("unauthorized", 401);

  let body: Body;
  try { body = await req.json(); } catch { return bad("invalid JSON body"); }
  if (!body.customer) return bad("customer is required");
  if (!Array.isArray(body.lines) || body.lines.length === 0) return bad("at least one line is required");

  // Resolve the customer by id or code within the org.
  const [cust] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.organizationId, orgId), or(eq(customers.id, body.customer), eq(customers.code, body.customer)))).limit(1);
  if (!cust) return bad("customer not found");

  // Resolve items by id or code.
  const keys = [...new Set(body.lines.map((l) => l.item).filter(Boolean) as string[])];
  const itemRows = await db.select({ id: items.id, code: items.code }).from(items)
    .where(and(eq(items.organizationId, orgId), or(inArray(items.id, keys), inArray(items.code, keys))));
  const byKey = new Map<string, string>();
  for (const r of itemRows) { byKey.set(r.id, r.id); if (r.code) byKey.set(r.code, r.id); }

  const computed: { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; totalAmount: number }[] = [];
  for (const l of body.lines) {
    const itemId = l.item ? byKey.get(l.item) : undefined;
    if (!itemId) return bad(`item not found: ${l.item ?? "(missing)"}`);
    const quantity = Number(l.quantity);
    if (!(quantity > 0)) return bad("each line needs a positive quantity");
    const unitPrice = Number(l.unitPrice) || 0;
    const discountAmount = Number(l.discountAmount) || 0;
    const taxAmount = Number(l.taxAmount) || 0;
    computed.push({ itemId, quantity, unitPrice, discountAmount, taxAmount, totalAmount: round2(quantity * unitPrice - discountAmount + taxAmount) });
  }

  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal - discountAmount + taxAmount);

  const d = body.date ? new Date(body.date) : new Date();
  if (isNaN(d.getTime())) return bad("invalid date");

  try {
    const result = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, orgId, "SO", d.getFullYear());
      const [so] = await tx.insert(salesOrders).values({
        organizationId: orgId, number, customerId: cust.id, date: d, status: "DRAFT",
        subtotal: String(subtotal), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
        shippingAmount: "0", totalAmount: String(totalAmount), channel: "MANUAL",
        notes: body.notes?.trim() || "أُنشئ عبر API",
      }).returning({ id: salesOrders.id, number: salesOrders.number });
      await tx.insert(salesOrderLines).values(computed.map((l) => ({
        salesOrderId: so.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      return so;
    });
    return Response.json({ data: { id: result.id, number: result.number, status: "DRAFT", total: totalAmount } }, { status: 201 });
  } catch {
    return bad("could not create the order", 500);
  }
}
