"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  upsertCurrencyAction,
  upsertExchangeRateAction,
  toggleCurrencyActiveAction,
} from "@/app/actions/erp/currencies";

type Currency = {
  id: string;
  code: string;
  nameAr: string;
  symbol: string;
  isBase: boolean;
  isActive: boolean;
  exchangeRate: string;
};

type Rate = {
  id: string;
  currencyCode: string;
  date: Date;
  rate: string;
};

const PRESETS = [
  { code: "SAR", nameAr: "ريال سعودي",   symbol: "﷼" },
  { code: "USD", nameAr: "دولار أمريكي",  symbol: "$" },
  { code: "EUR", nameAr: "يورو",           symbol: "€" },
  { code: "GBP", nameAr: "جنيه إسترليني", symbol: "£" },
  { code: "AED", nameAr: "درهم إماراتي",  symbol: "د.إ" },
  { code: "EGP", nameAr: "جنيه مصري",     symbol: "ج.م" },
  { code: "KWD", nameAr: "دينار كويتي",   symbol: "د.ك" },
  { code: "QAR", nameAr: "ريال قطري",     symbol: "ر.ق" },
];

function CurrencyDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [usePreset, setUsePreset] = useState(true);
  const [preset, setPreset] = useState("USD");
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [isBase, setIsBase] = useState(false);
  const [currentRate, setCurrentRate] = useState("");
  const [error, setError] = useState<string>();

  const selectedPreset = PRESETS.find((p) => p.code === preset);

  function save() {
    const input = usePreset && selectedPreset
      ? { code: selectedPreset.code, nameAr: selectedPreset.nameAr, symbol: selectedPreset.symbol }
      : { code: code.toUpperCase(), nameAr, symbol: "؟" };

    setError(undefined);
    startTransition(async () => {
      const res = await upsertCurrencyAction({
        code: input.code,
        nameAr: input.nameAr,
        symbol: input.symbol,
        isBase,
        currentRate: currentRate ? Number(currentRate) : undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      toast.success("تمت إضافة العملة");
      onClose();
      router.refresh();
    });
  }

  return (
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>إضافة عملة</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>اختر من القائمة</Label>
          <Select value={preset} onValueChange={(v) => { setPreset(v); setUsePreset(true); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.code} value={p.code}>{p.code} — {p.nameAr}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex-1 border-t" />أو أدخل يدويًا<div className="flex-1 border-t" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>الكود (ISO)</Label>
            <Input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setUsePreset(false); }}
              placeholder="USD"
              maxLength={5}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>الاسم بالعربية</Label>
            <Input
              value={nameAr}
              onChange={(e) => { setNameAr(e.target.value); setUsePreset(false); }}
              placeholder="دولار أمريكي"
            />
          </div>
        </div>

        {!isBase && (
          <div className="space-y-1.5">
            <Label>السعر الحالي (1 {usePreset ? preset : code} = ؟ عملة أساسية)</Label>
            <Input
              type="number"
              min="0.000001"
              step="0.000001"
              value={currentRate}
              onChange={(e) => setCurrentRate(e.target.value)}
              placeholder="مثال: 3.75"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="isBase"
            checked={isBase}
            onChange={(e) => setIsBase(e.target.checked)}
            className="size-4"
          />
          <Label htmlFor="isBase">هذه هي العملة الأساسية للمنظومة</Label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending ? "جارٍ الحفظ…" : "إضافة"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function RateDialog({ currencies, baseCurrency, onClose }: { currencies: Currency[]; baseCurrency?: Currency; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nonBase = currencies.filter((c) => !c.isBase && c.isActive);
  const [currCode, setCurrCode] = useState(nonBase[0]?.code ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string>();

  function save() {
    if (!currCode) { setError("اختر العملة"); return; }
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) { setError("سعر الصرف غير صحيح"); return; }
    setError(undefined);
    startTransition(async () => {
      const res = await upsertExchangeRateAction({ currencyCode: currCode, date, rate: Number(rate) });
      if (!res.ok) { setError(res.error); return; }
      toast.success("تم حفظ سعر الصرف");
      onClose();
      router.refresh();
    });
  }

  return (
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>تحديث سعر الصرف</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {nonBase.length === 0
          ? <p className="text-sm text-muted-foreground">أضف عملات أجنبية أولًا.</p>
          : (
            <>
              <div className="space-y-1.5">
                <Label>العملة</Label>
                <Select value={currCode} onValueChange={setCurrCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {nonBase.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.code} — {c.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>التاريخ</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>1 {currCode} = كم {baseCurrency?.code ?? "SAR"}</Label>
                  <Input
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="3.750000"
                  />
                </div>
              </div>
            </>
          )
        }
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        {nonBase.length > 0 && (
          <Button onClick={save} disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ"}</Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

export function CurrenciesManager({
  currencies: currList,
  rates,
}: {
  currencies: Currency[];
  rates: Rate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showRate, setShowRate] = useState(false);

  const baseCurrency = currList.find((c) => c.isBase);

  return (
    <div className="space-y-6">
      {/* Currencies list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>العملات</CardTitle>
            <CardDescription>
              العملة الأساسية هي وحدة القياس في دفتر الأستاذ — تُستخدم في كل القيود المحاسبية.
              العملات الأخرى تُحوَّل إليها بسعر الصرف عند الترحيل.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="me-1.5 size-4" /> إضافة عملة
          </Button>
        </CardHeader>
        <CardContent>
          {currList.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground text-sm">
              لا توجد عملات — أضف العملة الأساسية أولًا (مثلًا SAR).
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr className="[&>th]:p-3 [&>th]:text-start">
                    <th>الكود</th>
                    <th>الاسم</th>
                    <th>الرمز</th>
                    <th>السعر الحالي</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {currList.map((c) => (
                    <tr key={c.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
                      <td className="font-mono font-semibold">{c.code}</td>
                      <td>
                        {c.nameAr}
                        {c.isBase && (
                          <Star className="ms-1.5 inline size-3 fill-yellow-400 text-yellow-400" />
                        )}
                      </td>
                      <td className="text-muted-foreground">{c.symbol}</td>
                      <td className="tabular-nums text-muted-foreground">
                        {c.isBase ? "—" : `${Number(c.exchangeRate).toFixed(4)} ${baseCurrency?.code ?? ""}`}
                      </td>
                      <td>
                        <Badge variant={c.isActive ? "default" : "secondary"}>
                          {c.isBase ? "أساسية" : c.isActive ? "نشطة" : "معطّلة"}
                        </Badge>
                      </td>
                      <td>
                        {!c.isBase && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const r = await toggleCurrencyActiveAction(c.id);
                                if (!r.ok) toast.error(r.error ?? "خطأ");
                                else router.refresh();
                              })
                            }
                          >
                            <Power className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical exchange rates */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>سجل أسعار الصرف</CardTitle>
            <CardDescription>
              يُحفظ السعر بالتاريخ لضمان دقة التحويل في الفواتير التاريخية.
              آخر سعر مُدخَّل يُعتمد للترحيل.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowRate(true)} disabled={currList.filter(c => !c.isBase).length === 0}>
            <Plus className="me-1.5 size-4" /> تحديث سعر
          </Button>
        </CardHeader>
        <CardContent>
          {rates.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground text-sm">
              لا يوجد سجل أسعار — أضف سعر الصرف لكل عملة أجنبية.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr className="[&>th]:p-3 [&>th]:text-start">
                    <th>العملة</th>
                    <th>التاريخ</th>
                    <th>السعر (1 وحدة = ؟ {baseCurrency?.code ?? ""})</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="border-t [&>td]:p-3">
                      <td className="font-mono font-semibold">{r.currencyCode}</td>
                      <td className="text-xs">{new Date(r.date).toLocaleDateString("ar-EG")}</td>
                      <td className="tabular-nums">{Number(r.rate).toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={(o) => !o && setShowAdd(false)}>
        {showAdd && <CurrencyDialog onClose={() => setShowAdd(false)} />}
      </Dialog>
      <Dialog open={showRate} onOpenChange={(o) => !o && setShowRate(false)}>
        {showRate && <RateDialog currencies={currList} baseCurrency={baseCurrency} onClose={() => setShowRate(false)} />}
      </Dialog>
    </div>
  );
}
