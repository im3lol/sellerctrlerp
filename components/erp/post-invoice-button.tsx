"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function PostInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await postSalesInvoiceAction(id);
          if (r.ok) {
            toast.success("تم ترحيل الفاتورة محاسبياً");
            router.refresh();
          } else {
            toast.error(r.error ?? "تعذّر الترحيل");
          }
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="CircleCheck" className="size-4" />}
      ترحيل
    </Button>
  );
}
