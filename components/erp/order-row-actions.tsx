"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmSalesOrderAction, convertSalesOrderToInvoiceAction, cancelSalesOrderAction, deleteSalesOrderAction, revertSalesOrderToDraftAction,
} from "@/app/actions/erp/sales-orders";
import {
  confirmPurchaseOrderAction, convertPurchaseOrderToInvoiceAction, cancelPurchaseOrderAction, deletePurchaseOrderAction, revertPurchaseOrderToDraftAction, approvePurchaseOrderAction,
} from "@/app/actions/erp/purchase-orders";
import { fulfillOrderAction } from "@/app/actions/erp/fulfillment";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { confirm } from "@/components/erp/confirm";

export function OrderRowActions({
  orderId,
  type,
  status,
  canManage,
  poNeedsApproval,
  poApproved,
}: {
  orderId: string;
  type: "sales" | "purchase";
  status: string;
  canManage: boolean;
  poNeedsApproval?: boolean;
  poApproved?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status === "INVOICED") return null;

  const isSales = type === "sales";
  const invoiceDest = isSales ? "/erp/sales/invoices" : "/erp/purchases/invoices";
  const fulfillPath = isSales ? `/erp/sales/orders/${orderId}/deliver` : `/erp/purchases/orders/${orderId}/receive`;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  // CANCELLED: can be deleted if it isn't linked to any receipt/delivery.
  if (status === "CANCELLED") {
    return (
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => run(() => isSales ? deleteSalesOrderAction(orderId) : deletePurchaseOrderAction(orderId), "تم حذف الأمر", isSales ? "/erp/sales/orders" : "/erp/purchases/orders")}>
        <Icon name="Trash2" className="size-4 text-destructive" />حذف
      </Button>
    );
  }

  // DRAFT: confirm or cancel (delete the draft) — no stock/GL yet. A purchase
  // order above the approval threshold must be approved before it can be confirmed.
  if (status === "DRAFT") {
    const needApprove = type === "purchase" && poNeedsApproval && !poApproved;
    return (
      <div className="flex flex-wrap gap-1">
        {needApprove ? (
          <Button size="sm" disabled={pending}
            onClick={() => run(() => approvePurchaseOrderAction(orderId), "تم اعتماد الأمر")}>
            <Icon name="ShieldCheck" className="size-4" />اعتماد
          </Button>
        ) : (
          <Button size="sm" disabled={pending}
            onClick={() => run(() => isSales ? confirmSalesOrderAction(orderId) : confirmPurchaseOrderAction(orderId), "تم تأكيد الأمر")}>
            <Icon name="Check" className="size-4" />تأكيد
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => run(() => isSales ? deleteSalesOrderAction(orderId) : deletePurchaseOrderAction(orderId), "تم حذف المسودة")}>
          <Icon name="X" className="size-4 text-destructive" />إلغاء
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

  // Fully delivered/received but not invoiced — bill from the delivery/receipt.
  if (status === "DELIVERED" || status === "RECEIVED") return null;

  // CONFIRMED: actions dropdown — create the next document or cancel.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          إجراءات<Icon name="ChevronDown" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {isSales && (
          <>
            <DropdownMenuItem className="font-medium text-emerald-700 focus:text-emerald-700"
              onClick={() => run(() => fulfillOrderAction(orderId), "تم تنفيذ الدورة: إذن صرف + فاتورة مُرحّلة")}>
              <Icon name="Zap" className="size-4" />الدورة الكاملة (صرف + فاتورة)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => router.push(fulfillPath)}>
          <Icon name={isSales ? "Truck" : "PackageCheck"} className="size-4" />
          {isSales ? "إنشاء إذن صرف" : "إنشاء إذن استلام"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run(
            () => isSales ? convertSalesOrderToInvoiceAction(orderId) : convertPurchaseOrderToInvoiceAction(orderId),
            "تم التحويل إلى فاتورة (مسودة)", invoiceDest,
          )}>
          <Icon name="FileText" className="size-4" />
          {isSales ? "إنشاء فاتورة بيع" : "إنشاء فاتورة شراء"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run(() => isSales ? revertSalesOrderToDraftAction(orderId) : revertPurchaseOrderToDraftAction(orderId), "تم إعادة فتح الأمر كمسودة")}>
          <Icon name="Undo2" className="size-4" />إعادة فتح كمسودة
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => run(() => isSales ? cancelSalesOrderAction(orderId) : cancelPurchaseOrderAction(orderId), "تم إلغاء الأمر")}>
          <Icon name="X" className="size-4" />إلغاء الأمر
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
