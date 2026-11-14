import { z } from "zod";

export const receiptDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "تاريخ استلام غير صالح");

const quantity = z.number().finite().min(0).max(1e10)
  .refine(n => Math.abs(n - Math.round(n * 10000) / 10000) < 1e-9, "الكمية تدعم أربع خانات عشرية كحد أقصى");

export const receiptPicksSchema = z.array(z.object({
  itemId: z.string().uuid(),
  quantity,
  rejectedQty: quantity.optional(),
  warehouseId: z.string().uuid().optional(),
  batchNo: z.string().max(200).nullable().optional(),
  expiryDate: receiptDateSchema.nullable().optional(),
  shippingPerUnit: z.number().finite().min(0).max(1e10).optional(),
})).max(2000).refine(rows => new Set(rows.map(r => r.itemId)).size === rows.length, "الصنف مكرر في بنود الاستلام");

export const receiptQty = (n: number) => Math.round(n * 10000) / 10000;
