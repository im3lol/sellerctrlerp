"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

const WHATSAPP = "201025246324";
const SELLS_ON = ["أمازون", "نون", "الاثنين", "متجري / منصة أخرى"];
const MODULES = [
  "المحاسبة", "المخزون", "المبيعات", "المشتريات",
  "تكامل منصات البيع (أمازون/نون)", "الموارد البشرية", "المستثمرون", "التقارير والتحليلات",
];

type BtnProps = {
  label?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
};

/**
 * Landing "request a demo" CTA. Collects a light lead (name / WhatsApp / business
 * / channel / modules of interest / free-text notes) and hands off to WhatsApp
 * with a prefilled message — no backend, the message itself carries the lead.
 * We then send the demo link back manually.
 */
export function DemoRequestButton({ label = "اطلب ديمو", size, variant, className }: BtnProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [sells, setSells] = useState(SELLS_ON[0]);
  const [modules, setModules] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const valid = name.trim().length >= 2 && phone.trim().length >= 6;
  const toggleModule = (m: string) =>
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const msg =
      `السلام عليكم 👋\nحابب أجرّب ديمو SellerCtrl.\n\n` +
      `الاسم: ${name.trim()}\n` +
      `النشاط / المتجر: ${business.trim() || "—"}\n` +
      `ببيع على: ${sells}\n` +
      `رقم واتساب: ${phone.trim()}\n` +
      `مهتم بالوحدات: ${modules.length ? modules.join("، ") : "لسه بستكشف"}\n` +
      `ملاحظات: ${notes.trim() || "—"}`;
    window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={variant} className={className}>
          <MessageCircle className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>اطلب نسخة تجريبية</DialogTitle>
          <DialogDescription>سجّل بياناتك وهنبعتلك لينك الديمو على واتساب تجرّب النظام بنفسك.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dr-name">الاسم</Label>
            <Input id="dr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-phone">رقم واتساب</Label>
            <Input id="dr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-business">اسم النشاط / المتجر (اختياري)</Label>
            <Input id="dr-business" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="مثال: متجر النخبة" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-sells">بتبيع على إيه؟</Label>
            <select
              id="dr-sells"
              value={sells}
              onChange={(e) => setSells(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {SELLS_ON.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>الوحدات اللي مهتم بيها (اختياري)</Label>
            <div className="grid grid-cols-2 gap-2">
              {MODULES.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <Checkbox checked={modules.includes(m)} onCheckedChange={() => toggleModule(m)} />
                  <span>{m}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-notes">ملاحظات (اختياري)</Label>
            <Textarea
              id="dr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="مشاكل بتواجهك في نظامك الحالي، أو حاجات معيّنة بتدوّر عليها في النظام…"
            />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={!valid}>
            <MessageCircle className="size-4" />
            أكمل على واتساب
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">أو راسلنا مباشرة على واتساب ‎+{WHATSAPP}</p>
      </DialogContent>
    </Dialog>
  );
}
