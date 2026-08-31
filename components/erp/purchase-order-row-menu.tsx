"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmPurchaseOrderAction, convertPurchaseOrderToInvoiceAction, cancelPurchaseOrderAction, deletePurchaseOrderAction, revertPurchaseOrderToDraftAction, approvePurchaseOrderAction,
} from "@/app/actions/erp/purchase-orders";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { confirm } from "@/components/erp/confirm";

/** Per-row "⋮" quick actions for the purchase orders list — same status-driven
 *  actions as OrderRowActions (the detail-page header version), just compacted
 *  into menu items so a single action doesn't require opening the order first. */
export function PurchaseOrderRowMenu({
  orderId, number, status, canManage, poNeedsApproval, poApproved,
}: {
  orderId: string; number: string; status: string; canManage: boolean;
  poNeedsApproval?: boolean; poApproved?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

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

  const encoded = encodeURIComponent(number);
  const needApprove = !!poNeedsApproval && !poApproved;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" disabled={pending} aria-label="إجراءات">
          <Icon name="MoreVertical" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild><Link href={`/purchases/orders/${encoded}`}><Icon name="Eye" className="size-4" />فتح</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/purchases/orders/${encoded}/print`} target="_blank" rel="noopener"><Icon name="Printer" className="size-4" />طباعة</Link></DropdownMenuItem>

        {canManage && status === "DRAFT" && (
          <>
            <DropdownMenuSeparator />
            {needApprove ? (
              <DropdownMenuItem onClick={() => run(() => approvePurchaseOrderAction(orderId), "تم اعتماد الأمر")}>
                <Icon name="ShieldCheck" className="size-4" />اعتماد
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => run(() => confirmPurchaseOrderAction(orderId), "تم تأكيد الأمر")}>
                <Icon name="Check" className="size-4" />تأكيد
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild><Link href={`/purchases/orders/${orderId}/edit`}><Icon name="Pencil" className="size-4" />تعديل</Link></DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => deletePurchaseOrderAction(orderId), "تم حذف المسودة")}>
              <Icon name="X" className="size-4" />إلغاء
            </DropdownMenuItem>
          </>
        )}

        {canManage && status === "CANCELLED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => deletePurchaseOrderAction(orderId), "تم حذف الأمر", "/purchases/orders")}>
              <Icon name="Trash2" className="size-4" />حذف
            </DropdownMenuItem>
          </>
        )}

        {canManage && status === "PARTIALLY_RECEIVED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href={`/purchases/orders/${orderId}/receive`}><Icon name="PackageCheck" className="size-4" />متابعة الاستلام</Link></DropdownMenuItem>
          </>
        )}

        {canManage && status === "CONFIRMED" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href={`/purchases/orders/${orderId}/receive`}><Icon name="PackageCheck" className="size-4" />إنشاء إذن استلام</Link></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => convertPurchaseOrderToInvoiceAction(orderId), "تم التحويل إلى فاتورة (مسودة)", "/purchases/invoices")}>
              <Icon name="FileText" className="size-4" />إنشاء فاتورة شراء
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => revertPurchaseOrderToDraftAction(orderId), "تم إعادة فتح الأمر كمسودة")}>
              <Icon name="Undo2" className="size-4" />إعادة فتح كمسودة
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => run(() => cancelPurchaseOrderAction(orderId), "تم إلغاء الأمر")}>
              <Icon name="X" className="size-4" />إلغاء الأمر
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
