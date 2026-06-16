"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateProductFieldAction } from "@/app/actions/products";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function EditableField({
  productId,
  field,
  label,
  value,
  canEdit,
  placeholder,
}: {
  productId: string;
  field: "notes" | "amazonCode" | "internalNotes";
  label: string;
  value: string | null;
  canEdit: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      try {
        await updateProductFieldAction(productId, field, val);
        toast.success("تم الحفظ");
        setEditing(false);
      } catch {
        toast.error("تعذّر الحفظ");
      }
    });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {canEdit && !editing && (
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} placeholder={placeholder} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              حفظ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setVal(value ?? ""); setEditing(false); }}>
              إلغاء
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">
          {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
        </p>
      )}
    </div>
  );
}
