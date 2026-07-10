"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Copy, Trash2 } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/erp/api-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ApiKey = { id: string; name: string; hint: string; lastUsed: string; active: boolean };

export function ApiKeysManager({ keys }: { keys: ApiKey[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = () => start(async () => {
    const r = await createApiKeyAction(name);
    if ("ok" in r && r.ok) { setNewKey(r.key ?? null); setName(""); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر الإنشاء");
  });
  const revoke = (id: string) => start(async () => { const r = await revokeApiKeyAction(id); if (r.ok) { toast.success("تم إلغاء المفتاح"); router.refresh(); } else toast.error(r.error ?? ""); });
  const closeDialog = () => { setOpen(false); setNewKey(null); setName(""); };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{keys.length} مفتاح — للوصول للبيانات عبر REST API (قراءة فقط)</span>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />مفتاح جديد</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">الاسم</TableHead><TableHead className="text-start">المفتاح</TableHead>
            <TableHead className="text-start">آخر استخدام</TableHead><TableHead className="text-start">الحالة</TableHead><TableHead className="text-start">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">لا توجد مفاتيح.</TableCell></TableRow>
            ) : keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground" dir="ltr">{k.hint}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{k.lastUsed || "—"}</TableCell>
                <TableCell><Badge variant={k.active ? "default" : "outline"}>{k.active ? "فعّال" : "ملغى"}</Badge></TableCell>
                <TableCell>{k.active && <Button size="sm" variant="ghost" disabled={pending} onClick={() => revoke(k.id)}><Trash2 className="size-4 text-destructive" />إلغاء</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مفتاح API جديد</DialogTitle>
            <DialogDescription>{newKey ? "انسخ المفتاح الآن — لن يظهر مرة أخرى." : "سيُعرض المفتاح مرة واحدة فقط عند الإنشاء."}</DialogDescription>
          </DialogHeader>
          {newKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <code className="flex-1 break-all font-mono text-sm" dir="ltr">{newKey}</code>
                <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard?.writeText(newKey); toast.success("تم النسخ"); }}><Copy className="size-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">استخدمه في الترويسة: <code dir="ltr">Authorization: Bearer {newKey.slice(0, 10)}…</code> على <code dir="ltr">/api/v1/items</code> أو <code dir="ltr">/api/v1/stock</code>.</p>
            </div>
          ) : (
            <div className="space-y-1.5"><Label>اسم المفتاح</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="تكامل المتجر" /></div>
          )}
          <DialogFooter>
            {newKey ? <Button onClick={closeDialog}>تم</Button> : (
              <>
                <Button variant="outline" onClick={closeDialog}>إلغاء</Button>
                <Button onClick={create} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}إنشاء</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
