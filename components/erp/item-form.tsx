"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveItemAction, uploadItemImageAction } from "@/app/actions/erp/items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { ItemCombobox } from "@/components/erp/item-combobox";
import { selectCls } from "@/lib/utils";

const CODE_TYPES = ["BARCODE", "SKU", "ASIN", "UPC", "EAN", "FNSKU", "AMAZON", "NOON", "OTHER"] as const;

type CodeRow = { codeType: string; code: string };
export type ItemFormInitial = {
  id?: string; code?: string; nameAr?: string; description?: string;
  sellPrice?: string | number; minStock?: string | number; image?: string; codes?: CodeRow[];
  brand?: string | null; weight?: string | null; weightKg?: string | number | null; dimensions?: string | null;
  isPerishable?: boolean; shelfLifeDays?: string | number | null; tracking?: string | null;
  parentItemId?: string | null; parentLabel?: string | null; variationValue?: string | null;
};

export function ItemForm({ initial }: { initial?: ItemFormInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState(initial?.code ?? "");
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sellPrice, setSellPrice] = useState(String(initial?.sellPrice ?? "0"));
  const [minStock, setMinStock] = useState(String(initial?.minStock ?? "0"));
  const [isPerishable, setIsPerishable] = useState(Boolean(initial?.isPerishable));
  const [tracking, setTracking] = useState(initial?.tracking ?? "NONE");
  const [shelfLifeDays, setShelfLifeDays] = useState(initial?.shelfLifeDays != null ? String(initial.shelfLifeDays) : "");
  const [image, setImage] = useState(initial?.image ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [weight, setWeight] = useState(initial?.weight ?? "");
  const [weightKg, setWeightKg] = useState(initial?.weightKg != null ? String(initial.weightKg) : "");
  const [dimensions, setDimensions] = useState(initial?.dimensions ?? "");
  const [codes, setCodes] = useState<CodeRow[]>(initial?.codes?.length ? initial.codes : [{ codeType: "BARCODE", code: "" }]);
  const [parentItemId, setParentItemId] = useState(initial?.parentItemId ?? "");
  const [parentLabel, setParentLabel] = useState(initial?.parentLabel ?? "");
  const [variationValue, setVariationValue] = useState(initial?.variationValue ?? "");

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
        id: initial?.id, code, nameAr, description,
        sellPrice: Number(sellPrice) || 0, minStock: Number(minStock) || 0, image,
        brand, weight, weightKg: weightKg ? Number(weightKg) : undefined, dimensions,
        isPerishable, shelfLifeDays: isPerishable && shelfLifeDays ? Number(shelfLifeDays) : undefined,
        tracking,
        parentItemId: parentItemId || undefined, variationValue: variationValue || undefined,
        codes: codes.filter((c) => c.code.trim()),
      });
      if (r.ok) {
        toast.success("تم حفظ الصنف");
        router.push(r.id ? `/inventory/items/${r.id}` : "/inventory/items");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>بيانات الصنف</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>الكود الداخلي</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ITM-1001" /></div>
          <div className="space-y-2"><Label>الاسم</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="اسم الصنف (عربي أو إنجليزي)" /></div>
          <div className="space-y-2"><Label>سعر البيع</Label><Input type="number" step="0.01" min="0" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></div>
          <div className="space-y-2"><Label>حد إعادة الطلب</Label><Input type="number" step="0.001" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
          <div className="space-y-2"><Label>العلامة التجارية</Label><Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="مثال: Logitech" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2"><Label>الوزن</Label><Input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.5 kg" /></div>
            <div className="space-y-2">
              <Label>الوزن بالكيلوجرام <span className="font-normal text-muted-foreground">(لحساب تكلفة الشحن)</span></Label>
              <Input type="number" step="0.001" min="0" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="0.500" dir="ltr" />
            </div>
            <div className="space-y-2"><Label>الأبعاد</Label><Input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="10 × 5 × 3 cm" /></div>
          </div>
          <div className="space-y-2 sm:col-span-2"><Label>الوصف</Label>
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف الصنف…" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="tracking">تتبّع الوحدات</Label>
            <select id="tracking" className={selectCls} value={tracking} onChange={(e) => setTracking(e.target.value)}>
              <option value="NONE">بالكمية فقط</option>
              <option value="SERIAL">برقم تسلسلي لكل قطعة</option>
            </select>
            <p className="text-xs text-muted-foreground">
              التتبّع بالرقم التسلسلي بيطلب رقم لكل قطعة عند الاستلام، ويجاوب على «القطعة دي راحت فين ومين اشتراها».
              مناسب للأجهزة والإلكترونيات، مش للأصناف اللي بتتباع بالكيلو أو الكرتونة.
            </p>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input id="perishable" type="checkbox" className="size-4 rounded border-input" checked={isPerishable} onChange={(e) => setIsPerishable(e.target.checked)} />
            <Label htmlFor="perishable" className="cursor-pointer">صنف له تاريخ صلاحية (يُتتبَّع بالدفعات/FEFO)</Label>
          </div>
          {isPerishable && (
            <div className="space-y-2">
              <Label>مدة الصلاحية (أيام) — اختياري</Label>
              <Input type="number" min="0" step="1" value={shelfLifeDays} onChange={(e) => setShelfLifeDays(e.target.value)} placeholder="مثال: 365 — لاقتراح تاريخ الانتهاء عند الاستلام" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>صورة الصنف</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="size-32 shrink-0 overflow-hidden rounded-xl border bg-muted/40">
            {image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={image} alt="" className="size-full object-contain" />
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
        <CardHeader>
          <CardTitle>عائلة التنويعات (اختياري)</CardTitle>
          <CardDescription>اربط هذا الصنف كتنويعة تحت منتج أب — يعمل مع أي منصة (أمازون/نون/جوميا) أو بدون منصة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {parentItemId ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
              <Icon name="Boxes" className="size-4 text-primary" />
              <span className="flex-1 text-sm">المنتج الأب: <span className="font-medium">{parentLabel || parentItemId}</span></span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setParentItemId(""); setParentLabel(""); setVariationValue(""); }}>
                <Icon name="X" className="size-4" />فك الربط
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>المنتج الأب</Label>
              <ItemCombobox
                placeholder="ابحث عن المنتج الأب بالاسم أو الكود…"
                onSelect={(it) => {
                  if (it.id === initial?.id) { toast.error("لا يمكن ربط الصنف بنفسه"); return; }
                  setParentItemId(it.id);
                  setParentLabel(`${it.code} — ${it.name}`);
                }}
              />
            </div>
          )}
          {parentItemId && (
            <div className="space-y-2">
              <Label>قيمة التنويعة</Label>
              <Input value={variationValue} onChange={(e) => setVariationValue(e.target.value)} placeholder="مثال: أحمر - L" />
            </div>
          )}
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
        <Button variant="outline" onClick={() => router.push("/inventory/items")}>إلغاء</Button>
        <Button onClick={submit} disabled={pending}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}حفظ الصنف</Button>
      </div>
    </div>
  );
}
