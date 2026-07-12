import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { prep, groupByRef, parseDate, nz } from "@/lib/erp/doc-import-parse";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { round2 } from "@/lib/erp/money";
import { tryRecordAudit } from "@/lib/erp/audit";
import {
  customers, suppliers, items, warehouses,
  salesOrders, salesOrderLines, purchaseOrders, purchaseOrderLines,
  stockTransfers, stockTransferLines,
} from "@/db/schema";

// DRAFT-only importers for transactional documents — the pure logic, no auth. The
// "use server" wrappers in app/actions/erp/doc-import.ts authorize then call these.
// Each parses a grouped CSV (one row per line, grouped by a `ref` column), resolves
// master data by code, and creates documents in DRAFT status ONLY — nothing posts
// to GL or stock. A human reviews each draft and confirms it later.

export type DocImportResult = { created: number; errors: { ref: string; message: string }[]; total: number };

async function itemMap(orgId: string, codes: string[]) {
  const uniq = [...new Set(codes.filter(Boolean))];
  if (uniq.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: items.id, code: items.code }).from(items)
    .where(and(eq(items.organizationId, orgId), inArray(items.code, uniq)));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function warehouseMap(orgId: string, _keys: string[]) {
  const rows = await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.nameAr }).from(warehouses)
    .where(eq(warehouses.organizationId, orgId));
  const m = new Map<string, string>();
  for (const r of rows) { if (r.code) m.set(r.code, r.id); if (r.name) m.set(r.name, r.id); } // resolve by code OR Arabic name
  return m;
}

// ── Sales orders ──────────────────────────────────────────────────────────────
export async function importSalesOrdersCore(orgId: string, userId: string, csvText: string): Promise<DocImportResult> {
  const p = prep(csvText);
  if (!p) return { created: 0, errors: [], total: 0 };
  const groups = groupByRef(p.dataRows, (r) => p.col(r, ["ref", "مرجع", "order", "الطلب"]));

  const custCodes = [...new Set(groups.map((g) => p.col(g.rows[0], ["customer", "العميل", "كود العميل", "customercode"])).filter(Boolean))];
  const custRows = await db.select({ id: customers.id, code: customers.code }).from(customers)
    .where(and(eq(customers.organizationId, orgId), inArray(customers.code, custCodes.length ? custCodes : ["__none__"])));
  const custByCode = new Map(custRows.map((r) => [r.code, r.id]));
  const items_ = await itemMap(orgId, p.dataRows.map((r) => p.col(r, ["item", "الصنف", "كود الصنف", "itemcode"])));

  const result: DocImportResult = { created: 0, errors: [], total: groups.length };
  for (const g of groups) {
    try {
      const custCode = p.col(g.rows[0], ["customer", "العميل", "كود العميل", "customercode"]);
      const customerId = custByCode.get(custCode);
      if (!customerId) { result.errors.push({ ref: g.ref, message: `العميل غير موجود: ${custCode || "(فارغ)"}` }); continue; }
      const lines: { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; totalAmount: number }[] = [];
      let bad = "";
      for (const row of g.rows) {
        const itemCode = p.col(row, ["item", "الصنف", "كود الصنف", "itemcode"]);
        const itemId = items_.get(itemCode);
        if (!itemId) { bad = `الصنف غير موجود: ${itemCode || "(فارغ)"}`; break; }
        const quantity = nz(p.col(row, ["quantity", "الكمية", "qty"]));
        if (!(quantity > 0)) { bad = "كمية غير صالحة"; break; }
        const unitPrice = nz(p.col(row, ["unitprice", "السعر", "price", "سعر"]));
        const discountAmount = nz(p.col(row, ["discount", "الخصم"]));
        const taxAmount = nz(p.col(row, ["tax", "الضريبة"]));
        lines.push({ itemId, quantity, unitPrice, discountAmount, taxAmount, totalAmount: round2(quantity * unitPrice - discountAmount + taxAmount) });
      }
      if (bad) { result.errors.push({ ref: g.ref, message: bad }); continue; }

      const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
      const discountAmount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
      const taxAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
      const totalAmount = round2(subtotal - discountAmount + taxAmount);
      const d = parseDate(p.col(g.rows[0], ["date", "التاريخ"]));
      const number = await nextDocumentNumber(db, orgId, "SO", d.getFullYear());
      const id = await db.transaction(async (tx) => {
        const [so] = await tx.insert(salesOrders).values({
          organizationId: orgId, number, customerId, date: d, status: "DRAFT",
          subtotal: String(subtotal), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
          shippingAmount: "0", totalAmount: String(totalAmount), channel: "MANUAL", notes: `استيراد CSV (${g.ref})`,
        }).returning({ id: salesOrders.id });
        await tx.insert(salesOrderLines).values(lines.map((l) => ({
          salesOrderId: so.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
        })));
        return so.id;
      });
      await tryRecordAudit({ orgId, userId, action: "CREATE", entityType: "SALES_ORDER", entityId: id, entityNumber: number, summary: `استيراد أمر بيع ${number} (مسودة)`, metadata: { total: totalAmount, imported: true } });
      result.created++;
    } catch (e) {
      result.errors.push({ ref: g.ref, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
    }
  }
  return result;
}

// ── Purchase orders ───────────────────────────────────────────────────────────
export async function importPurchaseOrdersCore(orgId: string, userId: string, csvText: string): Promise<DocImportResult> {
  const p = prep(csvText);
  if (!p) return { created: 0, errors: [], total: 0 };
  const groups = groupByRef(p.dataRows, (r) => p.col(r, ["ref", "مرجع", "order", "الطلب"]));

  const supCodes = [...new Set(groups.map((g) => p.col(g.rows[0], ["supplier", "المورد", "suppliercode"])).filter(Boolean))];
  const supRows = await db.select({ id: suppliers.id, code: suppliers.code }).from(suppliers)
    .where(and(eq(suppliers.organizationId, orgId), inArray(suppliers.code, supCodes.length ? supCodes : ["__none__"])));
  const supByCode = new Map(supRows.map((r) => [r.code, r.id]));
  const whs = await warehouseMap(orgId, []);
  const items_ = await itemMap(orgId, p.dataRows.map((r) => p.col(r, ["item", "الصنف", "itemcode"])));

  const result: DocImportResult = { created: 0, errors: [], total: groups.length };
  for (const g of groups) {
    try {
      const supCode = p.col(g.rows[0], ["supplier", "المورد", "suppliercode"]);
      const supplierId = supByCode.get(supCode);
      if (!supplierId) { result.errors.push({ ref: g.ref, message: `المورد غير موجود: ${supCode || "(فارغ)"}` }); continue; }
      const whKey = p.col(g.rows[0], ["warehouse", "المستودع"]);
      const warehouseId = whs.get(whKey);
      if (!warehouseId) { result.errors.push({ ref: g.ref, message: `المستودع غير موجود: ${whKey || "(فارغ)"}` }); continue; }

      const lines: { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; totalAmount: number }[] = [];
      let bad = "";
      for (const row of g.rows) {
        const itemCode = p.col(row, ["item", "الصنف", "itemcode"]);
        const itemId = items_.get(itemCode);
        if (!itemId) { bad = `الصنف غير موجود: ${itemCode || "(فارغ)"}`; break; }
        const quantity = nz(p.col(row, ["quantity", "الكمية", "qty"]));
        if (!(quantity > 0)) { bad = "كمية غير صالحة"; break; }
        const unitPrice = nz(p.col(row, ["unitprice", "السعر", "price", "سعر"]));
        const discountAmount = nz(p.col(row, ["discount", "الخصم"]));
        const taxAmount = nz(p.col(row, ["tax", "الضريبة"]));
        lines.push({ itemId, quantity, unitPrice, discountAmount, taxAmount, totalAmount: round2(quantity * unitPrice - discountAmount + taxAmount) });
      }
      if (bad) { result.errors.push({ ref: g.ref, message: bad }); continue; }

      const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
      const discountAmount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
      const taxAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
      const totalAmount = round2(subtotal - discountAmount + taxAmount);
      const d = parseDate(p.col(g.rows[0], ["date", "التاريخ"]));
      const number = await nextDocumentNumber(db, orgId, "PO", d.getFullYear());
      const id = await db.transaction(async (tx) => {
        const [po] = await tx.insert(purchaseOrders).values({
          organizationId: orgId, number, supplierId, warehouseId, date: d, status: "DRAFT",
          subtotal: String(subtotal), shippingAmount: "0", discountAmount: String(discountAmount), taxAmount: String(taxAmount),
          totalAmount: String(totalAmount), notes: `استيراد CSV (${g.ref})`,
        }).returning({ id: purchaseOrders.id });
        await tx.insert(purchaseOrderLines).values(lines.map((l) => ({
          purchaseOrderId: po.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          shippingPerUnit: "0", discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
        })));
        return po.id;
      });
      await tryRecordAudit({ orgId, userId, action: "CREATE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: number, summary: `استيراد أمر شراء ${number} (مسودة)`, metadata: { total: totalAmount, imported: true } });
      result.created++;
    } catch (e) {
      result.errors.push({ ref: g.ref, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
    }
  }
  return result;
}

// ── Stock transfers ───────────────────────────────────────────────────────────
export async function importStockTransfersCore(orgId: string, userId: string, csvText: string): Promise<DocImportResult> {
  const p = prep(csvText);
  if (!p) return { created: 0, errors: [], total: 0 };
  const groups = groupByRef(p.dataRows, (r) => p.col(r, ["ref", "مرجع", "transfer", "التحويل"]));

  const whs = await warehouseMap(orgId, []);
  const items_ = await itemMap(orgId, p.dataRows.map((r) => p.col(r, ["item", "الصنف", "itemcode"])));

  const result: DocImportResult = { created: 0, errors: [], total: groups.length };
  for (const g of groups) {
    try {
      const lines: { itemId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number }[] = [];
      let bad = "";
      for (const row of g.rows) {
        const itemCode = p.col(row, ["item", "الصنف", "itemcode"]);
        const itemId = items_.get(itemCode);
        if (!itemId) { bad = `الصنف غير موجود: ${itemCode || "(فارغ)"}`; break; }
        const fromKey = p.col(row, ["fromwarehouse", "from", "من", "من مستودع"]);
        const toKey = p.col(row, ["towarehouse", "to", "إلى", "إلى مستودع"]);
        const fromWarehouseId = whs.get(fromKey);
        const toWarehouseId = whs.get(toKey);
        if (!fromWarehouseId) { bad = `مستودع المصدر غير موجود: ${fromKey || "(فارغ)"}`; break; }
        if (!toWarehouseId) { bad = `مستودع الوجهة غير موجود: ${toKey || "(فارغ)"}`; break; }
        if (fromWarehouseId === toWarehouseId) { bad = "المصدر والوجهة متماثلان"; break; }
        const quantity = nz(p.col(row, ["quantity", "الكمية", "qty"]));
        if (!(quantity > 0)) { bad = "كمية غير صالحة"; break; }
        lines.push({ itemId, fromWarehouseId, toWarehouseId, quantity });
      }
      if (bad) { result.errors.push({ ref: g.ref, message: bad }); continue; }

      const d = parseDate(p.col(g.rows[0], ["date", "التاريخ"]));
      const notes = p.col(g.rows[0], ["notes", "ملاحظات"]) || `استيراد CSV (${g.ref})`;
      const number = await nextDocumentNumber(db, orgId, "TR", d.getFullYear());
      const id = await db.transaction(async (tx) => {
        const [tr] = await tx.insert(stockTransfers).values({
          organizationId: orgId, number, date: d, status: "DRAFT", notes,
        }).returning({ id: stockTransfers.id });
        await tx.insert(stockTransferLines).values(lines.map((l) => ({
          stockTransferId: tr.id, itemId: l.itemId, fromWarehouseId: l.fromWarehouseId, toWarehouseId: l.toWarehouseId, quantity: String(l.quantity),
        })));
        return tr.id;
      });
      await tryRecordAudit({ orgId, userId, action: "CREATE", entityType: "STOCK_TRANSFER", entityId: id, entityNumber: number, summary: `استيراد تحويل مخزني ${number} (${lines.length} صنف، مسودة)`, metadata: { lines: lines.length, imported: true } });
      result.created++;
    } catch (e) {
      result.errors.push({ ref: g.ref, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
    }
  }
  return result;
}
