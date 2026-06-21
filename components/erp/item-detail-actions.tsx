"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteItemAction } from "@/app/actions/erp/items";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ItemDetailActions({ itemId, canEdit, canDelete }: { itemId: string; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canEdit && !canDelete) return null;

  const del = () =>
    start(async () => {
      const r = await deleteItemAction(itemId);
      if (r.ok) { toast.success("تم حذف الصنف"); router.push("/erp/inventory/items"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحذف");
    });

  return (
    <div className="flex gap-2">
      {canEdit && <Button asChild variant="outline" size="sm"><Link href={`/erp/inventory/items/${itemId}/edit`}><Icon name="Pencil" className="size-4" />تعديل</Link></Button>}
      {canDelete && <Button variant="ghost" size="sm" disabled={pending} onClick={del}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>}
    </div>
  );
}
