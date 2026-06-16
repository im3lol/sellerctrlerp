"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { previewHeadersAction, createSheetConnectionAction } from "@/app/actions/sheets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "name", label: "اسم المنتج" },
  { key: "asin", label: "ASIN" },
  { key: "brand", label: "البراند" },
  { key: "price", label: "السعر" },
];

export function ConnectSheetDialog({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, start] = useTransition();

  const [workspaceId, setWorkspaceId] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [headerRow, setHeaderRow] = useState(1);
  const [autoSync, setAutoSync] = useState(true);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});

  const reset = () => {
    setStep(1);
    setHeaders([]);
    setMap({});
  };

  const preview = () => {
    if (!workspaceId || !spreadsheetId) {
      toast.error("اختر مساحة العمل وأدخل معرّف الجدول");
      return;
    }
    start(async () => {
      const res = await previewHeadersAction(spreadsheetId, sheetName, headerRow);
      if (!res.ok || !res.headers) {
        toast.error(res.error ?? "تعذّر قراءة الأعمدة");
        return;
      }
      setHeaders(res.headers);
      // auto-guess mapping by common header names
      const guess: Record<string, string> = {};
      for (const f of FIELDS) {
        const hit = res.headers.find((h) =>
          h.toLowerCase().includes(f.key) || h.includes(f.label),
        );
        if (hit) guess[f.key] = hit;
      }
      setMap(guess);
      setStep(2);
    });
  };

  const create = () => {
    if (!map.sku) {
      toast.error("يجب تعيين عمود SKU");
      return;
    }
    start(async () => {
      const res = await createSheetConnectionAction({
        workspaceId,
        spreadsheetId,
        sheetName,
        headerRow,
        columnMap: map,
        autoSync,
      });
      if (!res.ok) {
        toast.error(res.error ?? "تعذّر الإنشاء");
        return;
      }
      toast.success("تم ربط الجدول");
      setOpen(false);
      reset();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          ربط Google Sheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ربط Google Sheet</DialogTitle>
          <DialogDescription>
            {step === 1 ? "أدخل بيانات الجدول لقراءة الأعمدة." : "طابق أعمدة الجدول مع حقول المنتج."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>مساحة العمل</Label>
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger><SelectValue placeholder="اختر مساحة العمل" /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>معرّف الجدول (Spreadsheet ID)</Label>
              <Input value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} dir="ltr" placeholder="1AbC..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>اسم الورقة</Label>
                <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>صف العناوين</Label>
                <Input type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))} dir="ltr" />
              </div>
            </div>
            <Button onClick={preview} disabled={pending} className="w-full">
              {pending && <Loader2 className="size-4 animate-spin" />}
              قراءة الأعمدة
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-[120px_1fr] items-center gap-3">
                  <Label>
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <Select
                    value={map[f.key] ?? "none"}
                    onValueChange={(v) => setMap((m) => ({ ...m, [f.key]: v === "none" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="بدون" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-sm font-medium">مزامنة تلقائية</p>
                <p className="text-xs text-muted-foreground">كل 5 دقائق</p>
              </div>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
            <p className="text-xs text-muted-foreground">
              الأعمدة المقفلة تُحدّث من الجدول. الحالة والملاحظات تبقى محفوظة في النظام.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="size-4 rotate-180" />
                رجوع
              </Button>
              <Button onClick={create} disabled={pending} className="flex-1">
                {pending && <Loader2 className="size-4 animate-spin" />}
                ربط ومزامنة
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
