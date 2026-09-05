"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmSalesOrderAction, convertSalesOrderToInvoiceAction, cancelSalesOrderAction, deleteSalesOrderAction, revertSalesOrderToDraftAction,
} from "@/app/actions/erp/sales-orders";
import { fulfillOrderAction } from "@/app/actions/erp/fulfillment";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { confirm } from "@/components/erp/confirm";
import { confirmPurge } from "@/components/erp/purge-confirm";

/** Per-row "⋮" quick actions for the sales orders list — sales half of
 *  OrderRowActions (the detail-page header version), compacted into menu items. */
export function SalesOrderRowMenu({ orderId, number, status, canManage }: { orderId: string; number: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string, purgeLabel?: string) => {
    void (async () => {
      if (!(await (purgeLabel ? confirmPurge(purgeLabel) : confirm({ danger: /حذف|إلغاء/.test(ok) })))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  /**
   * Confirming a sales order can bounce off the customer's credit limit. When the caller
   * is finance the action says so (creditBlocked) and a second, explicit confirmation
   * puts it through — the override is a deliberate act, and the audit trail records it.
   */
  const confirmSales = () =>
    void (async () => {
      if (!(await confirm({}))) return;
      start(async () => {
        const r = await confirmSalesOrderAction(orderId);
        if (r.ok) { toast.success("تم تأكيد الأمر"); router.refresh(); return; }
        if (!r.creditBlocked) { toast.error(r.error ?? "تعذّر التنفيذ"); return; }
        const go = await confirm({
          danger: true,
          title: "تجاوز حد الائتمان",
          description: `${r.error ?? ""}

التأكيد هيتسجّل في سجل المراجعة كتجاوز باعتماد مالي.`,
          confirmText: "أكّد رغم التجاوز",
          cancelText: "رجوع",
        });
        if (!go) return;
        start(async () => {
          const r2 = await confirmSalesOrderAction(orderId, { overrideCredit: true });
          if (r2.ok) { toast.success("تم تأكيد الأمر باعتماد مالي"); router.refresh(); }
          else toast.error(r2.error ?? "تعذّر التنفيذ");
        });
      });
    })();

  const encoded = encodeURIComponent(number);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" disabled={pending} aria-label="إجراءات">
          <Icon name="MoreVertical" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild><Link href={`/sales/orders/${encoded}`}><Icon name="Eye" className="size-4" />فتح</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/sales/orders/${encoded}/print`} target="_blank" rel="noopener"><Icon name="Printer" className="size-4" />طباعة</Link></DropdownMenuItem>

        {canManage && status === "DRAFT" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={confirmSales}>
              <Icon name="Check" className="size-4" />تأكيد
            </DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={`/sales/orders/${orderId}/edit`}><Icon name="Pencil" className="size-4" />تعديل</Link></DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => deleteSalesOrderAction(orderId), "تم حذف المسودة")}>
              <Icon name="X" className="size-4" />إلغاء
            </DropdownMenuItem>
          </>
        )}

        {canManage && status === "CANCELLED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => deleteSalesOrderAction(orderId), "تم حذف الأمر", "/sales/orders", "أمر البيع")}>
              <Icon name="Trash2" className="size-4" />حذف
            </DropdownMenuItem>
          </>
        )}

        {canManage && status === "PARTIALLY_DELIVERED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href={`/sales/orders/${orderId}/deliver`}><Icon name="Truck" className="size-4" />متابعة التسليم</Link></DropdownMenuItem>
          </>
        )}

        {canManage && status === "CONFIRMED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="font-medium text-emerald-700 focus:text-emerald-700"
              onClick={() => run(() => fulfillOrderAction(orderId), "تم تنفيذ الدورة: إذن صرف + فاتورة مُرحّلة")}>
              <Icon name="Zap" className="size-4" />الدورة الكاملة (صرف + فاتورة)
            </DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={`/sales/orders/${orderId}/deliver`}><Icon name="Truck" className="size-4" />إنشاء إذن صرف</Link></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => convertSalesOrderToInvoiceAction(orderId), "تم التحويل إلى فاتورة (مسودة)", "/sales/invoices")}>
              <Icon name="FileText" className="size-4" />إنشاء فاتورة بيع
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => revertSalesOrderToDraftAction(orderId), "تم إعادة فتح الأمر كمسودة")}>
              <Icon name="Undo2" className="size-4" />إعادة فتح كمسودة
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => cancelSalesOrderAction(orderId), "تم إلغاء الأمر")}>
              <Icon name="X" className="size-4" />إلغاء الأمر
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
