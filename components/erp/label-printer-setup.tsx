"use client";
import { useSyncExternalStore, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { DEFAULT_LABEL_LAYOUT, LABEL_LAYOUT_KEY, normalizeLabelLayout, type LabelPrintLayout } from "@/lib/erp/label-layout";
import { printLabelBatch } from "@/lib/erp/browser-label-print";
const subscribe=(notify:()=>void)=>{window.addEventListener("storage",notify);window.addEventListener("sellerctrl-label-layout",notify);return()=>{window.removeEventListener("storage",notify);window.removeEventListener("sellerctrl-label-layout",notify);};};
const read=()=>{try{return localStorage.getItem(LABEL_LAYOUT_KEY)||"";}catch{return "";}};
export function LabelPrinterSetup() {
 const saved=useSyncExternalStore(subscribe,read,()=>"");
 let initial=DEFAULT_LABEL_LAYOUT;try{initial=normalizeLabelLayout(JSON.parse(saved||"{}"));}catch{/* Invalid stored data uses defaults. */}
 return <LabelPrinterForm key={saved} initial={initial}/>;
}
function LabelPrinterForm({initial}:{initial:LabelPrintLayout}) {
 const t=useT();const [layout,setLayout]=useState(initial);
 const fields:[keyof LabelPrintLayout,string,number,number][]=[["width","عرض الملصق (مم)",30,150],["height","ارتفاع الملصق (مم)",20,150],["offsetX","إزاحة أفقية (مم)",-5,5],["offsetY","إزاحة رأسية (مم)",-5,5]];
 const save=()=>{try{const safe=normalizeLabelLayout(layout);localStorage.setItem(LABEL_LAYOUT_KEY,JSON.stringify(safe));setLayout(safe);window.dispatchEvent(new Event("sellerctrl-label-layout"));toast.success("تم حفظ معايرة الطباعة لهذا المتصفح");}catch{toast.error("تعذّر حفظ إعدادات هذا المتصفح");}};
 const test=async()=>{try{await printLabelBatch([{itemName:t("اختبار محاذاة SellerCtrl"),value:"SELLERCTRL-123"}],layout);}catch{toast.error("تعذّر فتح نافذة الطباعة");}};
 return <Card><CardHeader><CardTitle>{t("معايرة طابعة الملصقات")}</CardTitle><CardDescription>{t("هذه الإعدادات محفوظة لهذا المتصفح فقط، وتُطبق على طباعة ملصقات الأصناف والدفعات")}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">{fields.map(([key,label,min,max])=><div key={key} className="space-y-2"><Label htmlFor={`label-${key}`}>{t(label)}</Label><Input id={`label-${key}`} type="number" min={min} max={max} step="0.1" value={layout[key]} onChange={e=>setLayout(old=>({...old,[key]:Number(e.target.value)}))}/></div>)}</div><p className="text-sm leading-7 text-muted-foreground">{t("اختر المقاس نفسه في تعريف الطابعة، وقياس 100% دون هوامش أو ترويسات. اطبع ملصق الاختبار واضبط الإزاحة، ثم احفظ. استخدم قارئ الباركود للتأكد من قراءة SELLERCTRL-123.")}</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={save}>{t("حفظ المعايرة")}</Button><Button type="button" variant="outline" onClick={test}>{t("طباعة ملصق اختبار")}</Button><Button type="button" variant="ghost" onClick={()=>setLayout(DEFAULT_LABEL_LAYOUT)}>{t("استعادة المقاس الافتراضي")}</Button></div></CardContent></Card>;
}
