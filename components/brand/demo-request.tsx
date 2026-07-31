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

const WHATSAPP = "201025246324";
const SELLS_ON = ["أمازون", "نون", "الاثنين", "متجري / منصة أخرى"];

type BtnProps = {
  label?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
};

/**
 * Landing "request a demo" CTA. Collects a light lead (name / WhatsApp / business
 * / channel) and hands off to WhatsApp with a prefilled message — no backend, the
 * message itself carries the lead. We then send the demo link back manually.
 */
export function DemoRequestButton({ label = "اطلب ديمو", size, variant, className }: BtnProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [sells, setSells] = useState(SELLS_ON[0]);

  const valid = name.trim().length >= 2 && phone.trim().length >= 6;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const msg =
      `السلام عليكم 👋\nحابب أجرّب ديمو SellerCtrl.\n\n` +
      `الاسم: ${name.trim()}\n` +
      `النشاط / المتجر: ${business.trim() || "—"}\n` +
      `ببيع على: ${sells}\n` +
      `رقم واتساب: ${phone.trim()}`;
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
      <DialogContent className="max-w-md text-right">
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
