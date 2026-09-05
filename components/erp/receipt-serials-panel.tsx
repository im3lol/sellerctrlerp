"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getReceiptSerialsAction, saveReceiptSerialsAction } from "@/app/actions/erp/serials";
import { parseSerials, validateSerials } from "@/lib/erp/serials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

export type SerialLine = { itemId: string; code: string; name: string; quantity: number };

/**
 * Scan the serials for a draft receipt, one box at a time. Paste or scan — the parser
 * takes newlines, commas, semicolons and tabs, because a scanner and a spreadsheet
 * disagree about separators and neither is going to change.
 *
 * The count has to equal the quantity before the receipt can be confirmed; showing that
 * count live is the difference between fixing a mis-scan now and hitting a wall later.
 */
export function ReceiptSerialsPanel({ receiptId, lines, canEdit }: {
  receiptId: string; lines: SerialLine[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await getReceiptSerialsAction(receiptId);
      if (!alive) return;
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر تحميل الأرقام"); return; }
      const next: Record<string, string> = {};
      for (const [itemId, serials] of Object.entries(r.byItem ?? {})) next[itemId] = serials.join("\n");
      setText(next);
    })();
    return () => { alive = false; };
  }, [receiptId]);

  const save = () => {
    for (const l of lines) {
      const serials = parseSerials(text[l.itemId] ?? "");
      const err = validateSerials(serials, l.quantity);
      if (err) return toast.error(`${l.code}: ${err}`);
    }
    start(async () => {
      const r = await saveReceiptSerialsAction(
        receiptId,
        lines.map((l) => ({ itemId: l.itemId, serials: parseSerials(text[l.itemId] ?? "") })),
      );
      if (r.ok) { toast.success("تم حفظ الأرقام التسلسلية"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  if (loading || lines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>الأرقام التسلسلية</CardTitle>
            <CardDescription>
              رقم لكل قطعة، واحد في كل سطر (أو مفصولين بفاصلة). لازم العدد يساوي الكمية قبل تأكيد الاستلام.
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={save} disabled={pending}>
              <Icon name="Check" className="size-4" />حفظ الأرقام
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.map((l) => {
          const count = parseSerials(text[l.itemId] ?? "").length;
          const matched = count === l.quantity;
          return (
            <div key={l.itemId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="font-medium">{l.name}</Label>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</span>
                <Badge variant={matched ? "secondary" : "outline"} className={matched ? "" : "text-amber-600"}>
                  {count} / {l.quantity}
                </Badge>
              </div>
              <textarea
                className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm"
                dir="ltr"
                placeholder={"SN-0001\nSN-0002"}
                value={text[l.itemId] ?? ""}
                disabled={!canEdit || pending}
                onChange={(e) => setText((t) => ({ ...t, [l.itemId]: e.target.value }))}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
