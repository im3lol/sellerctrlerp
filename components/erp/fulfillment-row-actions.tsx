"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { convertDeliveryToInvoiceAction } from "@/app/actions/erp/deliveries";
import { convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function FulfillmentRowActions({
  docId,
  type,
  invoiced,
  canManage,
}: {
  docId: string;
  type: "delivery" | "receipt";
  invoiced: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || invoiced) return null;

  const dest = type === "delivery" ? "/erp/sales/invoices" : "/erp/purchases/invoices";

  const convert = () =>
    start(async () => {
      const r = type === "delivery" ? await convertDeliveryToInvoiceAction(docId) : await convertReceiptToInvoiceAction(docId);
      if (r.ok) { toast.success("تم إنشاء الفاتورة وترحيلها"); router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التحويل");
    });

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={convert}>
      <Icon name="FileText" className="size-4" />تحويل لفاتورة
    </Button>
  );
}
