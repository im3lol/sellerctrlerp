"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { convertSalesOrderToInvoiceAction, cancelSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { convertPurchaseOrderToInvoiceAction, cancelPurchaseOrderAction } from "@/app/actions/erp/purchase-orders";
import { createDeliveryFromOrderAction } from "@/app/actions/erp/deliveries";
import { createReceiptFromOrderAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function OrderRowActions({
  orderId,
  type,
  status,
  canManage,
}: {
  orderId: string;
  type: "sales" | "purchase";
  status: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || ["INVOICED", "CANCELLED", "DELIVERED", "RECEIVED"].includes(status)) return null;

  const isSales = type === "sales";
  const invoiceDest = isSales ? "/erp/sales/invoices" : "/erp/purchases/invoices";
  const fulfillDest = isSales ? "/erp/sales/deliveries" : "/erp/purchases/receipts";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" disabled={pending}
        onClick={() => run(
          () => isSales ? createDeliveryFromOrderAction(orderId) : createReceiptFromOrderAction(orderId),
          isSales ? "تم إنشاء إذن التسليم" : "تم إنشاء إذن الاستلام", fulfillDest,
        )}>
        <Icon name={isSales ? "Truck" : "PackageCheck"} className="size-4" />{isSales ? "تسليم" : "استلام"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => run(
          () => isSales ? convertSalesOrderToInvoiceAction(orderId) : convertPurchaseOrderToInvoiceAction(orderId),
          "تم التحويل إلى فاتورة (مسودة)", invoiceDest,
        )}>
        <Icon name="FileText" className="size-4" />فاتورة مباشرة
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="إلغاء"
        onClick={() => run(() => isSales ? cancelSalesOrderAction(orderId) : cancelPurchaseOrderAction(orderId), "تم الإلغاء")}>
        <Icon name="X" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
