"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, BadgeDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postFxRevaluationAction } from "@/app/actions/erp/fx-revaluation";

/** Posts the unrealized FX revaluation as a DRAFT journal entry for review. */
export function FxPostButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const post = () => start(async () => {
    const r = await postFxRevaluationAction();
    if ("ok" in r && r.ok) { toast.success("تم إنشاء قيد إعادة التقييم كمسودة — راجِعه وأكّده من القيود"); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر الترحيل");
  });
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={post} disabled={pending} title="ترحيل الفروق كقيد مسودة للمراجعة">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <BadgeDollarSign className="size-4" />}ترحيل كمسودة
    </Button>
  );
}
