"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveDocumentPrefixesAction } from "@/app/actions/erp/numbering";
import { DOC_TYPES } from "@/lib/erp/doc-types";
import type { ActionState } from "@/lib/erp/action-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function SaveBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ البادئات</Button>;
}

const YEAR = new Date().getFullYear();

/** One row per document type: an input whose placeholder is the default prefix + a live sample number. */
function Row({ docKey, label, initial, canEdit }: { docKey: string; label: string; initial: string; canEdit: boolean }) {
  const [val, setVal] = useState(initial);
  const prefix = (val || docKey).toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{prefix}-{YEAR}-0001</div>
      </div>
      <Input
        name={`prefix_${docKey}`}
        defaultValue={initial}
        placeholder={docKey}
        maxLength={6}
        disabled={!canEdit}
        onChange={(e) => setVal(e.target.value)}
        dir="ltr"
        className="w-24 text-center uppercase"
      />
    </div>
  );
}

export function NumberingForm({ overrides, canEdit }: { overrides: Record<string, string>; canEdit: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(saveDocumentPrefixesAction, {});
  useEffect(() => {
    if (state.ok) toast.success("تم حفظ بادئات الترقيم");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>بادئات ترقيم المستندات</CardTitle>
          <CardDescription>
            كل مستند رقمه <span dir="ltr" className="tabular-nums">البادئة-السنة-الرقم</span>. اترك الخانة فارغة لاستخدام الافتراضي.
            تغيير البادئة يبدأ ترقيمًا جديدًا لها ولا يغيّر أرقام المستندات القديمة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_TYPES.map((d) => (
              <Row key={d.key} docKey={d.key} label={d.label} initial={overrides[d.key] ?? ""} canEdit={canEdit} />
            ))}
          </div>
          {canEdit && <SaveBtn />}
        </CardContent>
      </Card>
    </form>
  );
}
