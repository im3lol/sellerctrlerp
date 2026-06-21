"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmSalesOrderAction, convertSalesOrderToInvoiceAction, cancelSalesOrderAction, deleteSalesOrderAction,
} from "@/app/actions/erp/sales-orders";
import {
  confirmPurchaseOrderAction, convertPurchaseOrderToInvoiceAction, cancelPurchaseOrderAction, deletePurchaseOrderAction,
} from "@/app/actions/erp/purchase-orders";
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
  if (!canManage || ["INVOICED", "CANCELLED"].includes(status)) return null;

  const isSales = type === "sales";
  const invoiceDest = isSales ? "/erp/sales/invoices" : "/erp/purchases/invoices";
  const fulfillPath = isSales ? `/erp/sales/orders/${orderId}/deliver` : `/erp/purchases/orders/${orderId}/receive`;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  // DRAFT: confirm or delete (no stock/GL yet).
  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={pending}
          onClick={() => run(() => isSales ? confirmSalesOrderAction(orderId) : confirmPurchaseOrderAction(orderId), "تم تأكيد الأمر")}>
          <Icon name="Check" className="size-4" />تأكيد
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف"
          onClick={() => run(() => isSales ? deleteSalesOrderAction(orderId) : deletePurchaseOrderAction(orderId), "تم حذف المسودة")}>
          <Icon name="Trash2" className="size-4 text-destructive" />
        </Button>
      </div>
    );
  }

  // Partially executed: continue fulfilling (rest stays as backorder).
  if (status === "PARTIALLY_DELIVERED" || status === "PARTIALLY_RECEIVED") {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => router.push(fulfillPath)}>
        <Icon name={isSales ? "Truck" : "PackageCheck"} className="size-4" />{isSales ? "متابعة التسليم" : "متابعة الاستلام"}
      </Button>
    );
  }

  // Fully delivered/received but not yet invoiced — bill from the delivery/receipt list.
  if (status === "DELIVERED" || status === "RECEIVED") return null;

  // CONFIRMED: start fulfilment, bill directly (whole order), or cancel.
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => router.push(fulfillPath)}>
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
