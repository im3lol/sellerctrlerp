"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setItemParentAction } from "@/app/actions/erp/items";
import type { FamilyMember } from "@/lib/erp/item-family";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { ItemCombobox } from "@/components/erp/item-combobox";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * Manage a product's variation family from its detail page. On a parent (or a
 * standalone item that can become one) it lists variations, links a new one, and
 * unlinks existing ones. On a child it shows the parent + siblings (read-only).
 */
export function ItemFamilyManager({
  currentItemId, isChild, canEdit, head, variations,
}: {
  currentItemId: string;
  isChild: boolean; // current item is itself a variation → no add control
  canEdit: boolean;
  head: FamilyMember | null;
  variations: FamilyMember[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [variation, setVariation] = useState("");

  const link = () => {
    if (!picked) return;
    start(async () => {
      const r = await setItemParentAction(picked.id, currentItemId, variation);
      if (r.ok) { toast.success("تم ربط التنويعة"); setPicked(null); setVariation(""); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الربط");
    });
  };
  const unlink = (childId: string) =>
    start(async () => {
      const r = await setItemParentAction(childId, null);
      if (r.ok) { toast.success("تم فك الربط"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر فك الربط");
    });

  const rows = head ? [head, ...variations] : [];
  const showAdd = canEdit && !isChild;

  return (
    <Card>
      <CardHeader>
        <CardTitle>التنويعات / عائلة المنتج</CardTitle>
        <CardDescription>المنتج الأب وكل التنويعات المرتبطة به — يعمل مع أي منصة (أمازون/نون/جوميا) أو بدون منصة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">التنويعة</TableHead>
                <TableHead className="text-start">الأكواد</TableHead>
                <TableHead className="text-start">السعر</TableHead>
                <TableHead className="text-start">المتوفّر</TableHead>
                {canEdit && <TableHead className="text-start"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const isCurrent = m.id === currentItemId;
                return (
                  <TableRow key={m.id} className={isCurrent ? "bg-primary/5" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="size-10 shrink-0 overflow-hidden rounded-lg border bg-muted/40">
                          {m.image
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={m.image} alt={m.name} className="size-full object-contain" />
                            : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-4" /></div>}
                        </div>
                        <div className="min-w-0">
                          {m.isHead && <Badge variant="secondary" className="mb-0.5 block w-fit">أب</Badge>}
                          {isCurrent ? (
                            <span className="font-medium"><span className="font-mono text-xs text-muted-foreground">{m.code}</span> {m.name}</span>
                          ) : (
                            <Link href={`/inventory/items/${encodeURIComponent(m.code)}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{m.code}</span> {m.name}</Link>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.variationValue ?? (m.isHead ? "—" : "")}</TableCell>
                    <TableCell className="text-xs">
                      {m.codes.length === 0 ? "—" : (
                        <div className="flex flex-wrap gap-1">
                          {m.codes.map((c, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5">
                              <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.type}</Badge>
                              <span className="font-mono">{c.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{money(m.sellPrice)}</TableCell>
                    <TableCell>{qf(m.stock)}</TableCell>
                    {canEdit && (
                      <TableCell>
                        {!m.isHead && (
                          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => unlink(m.id)}>
                            <Icon name="Unlink" className="size-4" />فك الربط
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد تنويعات مرتبطة بعد. اربط صنفاً كتنويعة أدناه.</p>
        )}

        {showAdd && (
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 text-sm font-medium">ربط تنويعة جديدة</div>
            {picked ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm">التنويعة: <span className="font-medium">{picked.label}</span></span>
                <Input value={variation} onChange={(e) => setVariation(e.target.value)} placeholder="قيمة التنويعة (مثال: أحمر - L)" className="w-48" />
                <Button type="button" size="sm" disabled={pending} onClick={link}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}ربط</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setPicked(null); setVariation(""); }}>إلغاء</Button>
              </div>
            ) : (
              <ItemCombobox
                placeholder="ابحث عن الصنف لربطه كتنويعة…"
                onSelect={(it) => {
                  if (it.id === currentItemId) { toast.error("لا يمكن ربط الصنف بنفسه"); return; }
                  setPicked({ id: it.id, label: `${it.code} — ${it.name}` });
                }}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
