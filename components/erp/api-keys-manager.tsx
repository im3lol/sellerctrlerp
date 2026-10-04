"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2, Plus, Copy, Trash2 } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/erp/api-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ApiKey = { id: string; name: string; hint: string; lastUsed: string; active: boolean; scope: "read" | "write"; expires: string; expired: boolean };

export function ApiKeysManager({ keys }: { keys: ApiKey[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [expiresInDays, setExpiresInDays] = useState("0"); // 0 = never
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = () => start(async () => {
    const r = await createApiKeyAction({ name, scope, expiresInDays: Number(expiresInDays) });
    if ("ok" in r && r.ok) { setNewKey(r.key ?? null); setName(""); router.refresh(); }
    else toast.error(("error" in r && r.error) || t("تعذّر الإنشاء"));
  });
  const revoke = (id: string) => start(async () => { const r = await revokeApiKeyAction(id); if (r.ok) { toast.success("تم إلغاء المفتاح"); router.refresh(); } else toast.error(r.error ?? ""); });
  const closeDialog = () => { setOpen(false); setNewKey(null); setName(""); setScope("write"); setExpiresInDays("0"); };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{keys.length} {t("مفتاح — للوصول للبيانات عبر REST API")}</span>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />{t("مفتاح جديد")}</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">{t("الاسم")}</TableHead><TableHead className="text-start">{t("المفتاح")}</TableHead>
            <TableHead className="text-start">{t("الصلاحية")}</TableHead><TableHead className="text-start">{t("الانتهاء")}</TableHead>
            <TableHead className="text-start">{t("آخر استخدام")}</TableHead><TableHead className="text-start">{t("الحالة")}</TableHead><TableHead className="text-start">{t("إجراءات")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("لا توجد مفاتيح.")}</TableCell></TableRow>
            ) : keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground" dir="ltr">{k.hint}</TableCell>
                <TableCell><Badge variant={k.scope === "write" ? "default" : "secondary"}>{k.scope === "write" ? t("قراءة/كتابة") : t("قراءة فقط")}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{k.expires ? <span className={k.expired ? "text-destructive" : ""}>{k.expires}</span> : "دائم"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{k.lastUsed || "—"}</TableCell>
                <TableCell><Badge variant={k.active && !k.expired ? "default" : "outline"}>{!k.active ? t("ملغى") : k.expired ? t("منتهٍ") : t("فعّال")}</Badge></TableCell>
                <TableCell>{k.active && <Button size="sm" variant="ghost" disabled={pending} onClick={() => revoke(k.id)}><Trash2 className="size-4 text-destructive" />{t("إلغاء")}</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("مفتاح API جديد")}</DialogTitle>
            <DialogDescription>{newKey ? t("انسخ المفتاح الآن — لن يظهر مرة أخرى.") : t("سيُعرض المفتاح مرة واحدة فقط عند الإنشاء.")}</DialogDescription>
          </DialogHeader>
          {newKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <code className="flex-1 break-all font-mono text-sm" dir="ltr">{newKey}</code>
                <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard?.writeText(newKey); toast.success("تم النسخ"); }}><Copy className="size-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("استخدمه في الترويسة:")} <code dir="ltr">Authorization: Bearer {newKey.slice(0, 10)}…</code> {t("على")} <code dir="ltr">/api/v1/items</code> {t("أو")} <code dir="ltr">/api/v1/stock</code>.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>{t("اسم المفتاح")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("تكامل المتجر")} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("الصلاحية")}</Label>
                  <select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="write">{t("قراءة/كتابة")}</option>
                    <option value="read">{t("قراءة فقط")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("الانتهاء")}</Label>
                  <select value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="0">{t("لا ينتهي")}</option>
                    <option value="30">{t("بعد ٣٠ يومًا")}</option>
                    <option value="90">{t("بعد ٩٠ يومًا")}</option>
                    <option value="365">{t("بعد سنة")}</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {newKey ? <Button onClick={closeDialog}>{t("تم")}</Button> : (
              <>
                <Button variant="outline" onClick={closeDialog}>{t("إلغاء")}</Button>
                <Button onClick={create} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("إنشاء")}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
