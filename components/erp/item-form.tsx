"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveItemAction, uploadItemImageAction } from "@/app/actions/erp/items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";

const CODE_TYPES = ["BARCODE", "SKU", "ASIN", "UPC", "EAN", "FNSKU", "AMAZON", "NOON", "OTHER"] as const;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";

type CodeRow = { codeType: string; code: string };
export type ItemFormInitial = {
  id?: string; code?: string; nameAr?: string; nameEn?: string; description?: string;
  sellPrice?: string | number; minStock?: string | number; image?: string; codes?: CodeRow[];
};

export function ItemForm({ initial }: { initial?: ItemFormInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState(initial?.code ?? "");
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sellPrice, setSellPrice] = useState(String(initial?.sellPrice ?? "0"));
  const [minStock, setMinStock] = useState(String(initial?.minStock ?? "0"));
  const [image, setImage] = useState(initial?.image ?? "");
  const [codes, setCodes] = useState<CodeRow[]>(initial?.codes?.length ? initial.codes : [{ codeType: "BARCODE", code: "" }]);

  const setCodeRow = (i: number, patch: Partial<CodeRow>) => setCodes((c) => c.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addCode = () => setCodes((c) => [...c, { codeType: "SKU", code: "" }]);
  const removeCode = (i: number) => setCodes((c) => c.filter((_, idx) => idx !== i));

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    const r = await uploadItemImageAction(fd);
    setUploading(false);
    if (r.ok && r.url) { setImage(r.url); toast.success("تم رفع الصورة"); }
    else toast.error(r.error ?? "تعذّر رفع الصورة");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () =>
    start(async () => {
      if (!code.trim()) { toast.error("أدخل الكود الداخلي"); return; }
      if (nameAr.trim().length < 2) { toast.error("أدخل اسم الصنف"); return; }
      const r = await saveItemAction({
        id: initial?.id, code, nameAr, nameEn, description,
        sellPrice: Number(sellPrice) || 0, minStock: Number(minStock) || 0, image,
        codes: codes.filter((c) => c.code.trim()),
      });
      if (r.ok) {
        toast.success("تم حفظ الصنف");
        router.push(r.id ? `/erp/inventory/items/${r.id}` : "/erp/inventory/items");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>بيانات الصنف</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>الكود الداخلي</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ITM-1001" /></div>
          <div className="space-y-2"><Label>الاسم</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="اسم الصنف" /></div>
          <div className="space-y-2"><Label>الاسم بالإنجليزية (اختياري)</Label><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></div>
          <div className="space-y-2"><Label>سعر البيع</Label><Input type="number" step="0.01" min="0" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></div>
          <div className="space-y-2"><Label>حد إعادة الطلب</Label><Input type="number" step="0.001" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>الوصف</Label>
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف الصنف…" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>صورة الصنف</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="size-32 shrink-0 overflow-hidden rounded-xl border bg-muted/40">
            {image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={image} alt="" className="size-full object-cover" />
              : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-8" /></div>}
          </div>
          <div className="flex-1 space-y-2">
            <Label>رابط الصورة</Label>
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… أو ارفع صورة" />
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Icon name={uploading ? "Loader2" : "Upload"} className={`size-4 ${uploading ? "animate-spin" : ""}`} />{uploading ? "جارٍ الرفع…" : "رفع صورة"}
              </Button>
              {image && <Button type="button" variant="ghost" size="sm" onClick={() => setImage("")}>إزالة</Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الأكواد (باركود / SKU / ASIN …)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {codes.map((c, i) => (
            <div key={i} className="flex gap-2">
              <select className={`${selectCls} w-32`} value={c.codeType} onChange={(e) => setCodeRow(i, { codeType: e.target.value })}>
                {CODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input value={c.code} onChange={(e) => setCodeRow(i, { code: e.target.value })} placeholder="القيمة" />
              <Button type="button" variant="ghost" size="icon" aria-label="حذف" onClick={() => removeCode(i)}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addCode}><Icon name="Plus" className="size-4" />إضافة كود</Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/erp/inventory/items")}>إلغاء</Button>
        <Button onClick={submit} disabled={pending}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}حفظ الصنف</Button>
      </div>
    </div>
  );
}
