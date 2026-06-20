"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, FileSpreadsheet, Loader2, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { importProductsAction } from "@/app/actions/import";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ImportProductsDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const fd = new FormData();
    fd.append("file", file);
    if (draft) fd.append("draft", "1");
    start(async () => {
      const res = await importProductsAction(workspaceId, fd);
      if (res.ok) {
        toast.success(
          draft
            ? `تم استيراد ${res.imported} منتج كمسودة — مخفية عن الموظفين حتى التأكيد`
            : `تم استيراد ${res.imported} منتج`,
        );
        setOpen(false);
        setFileName(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "تعذّر الاستيراد");
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="size-4" />
          استيراد Excel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>استيراد المنتجات من Excel</DialogTitle>
          <DialogDescription>
            نزّل القالب، أرسله للعميل ليملأ البيانات، ثم ارفع الملف هنا لاستيراد المنتجات.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <p className="text-sm font-medium">1. حمّل القالب</p>
              <p className="text-xs text-muted-foreground">يحتوي الأعمدة المطلوبة بالعربية</p>
            </div>
            <Button variant="secondary" asChild>
              <a href="/api/products/template" download>
                <Download className="size-4" />
                تنزيل القالب
              </a>
            </Button>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="draft-mode" className="flex items-center gap-1.5 text-sm font-medium">
                <EyeOff className="size-4" />
                وضع البيانات الناقصة (مسودة)
              </Label>
              <p className="text-xs text-muted-foreground">
                لو العميل أرسل لينك المنتج أو بيانات ناقصة فقط — تُضاف المنتجات لكن تظل مخفية عن الموظفين حتى تُكمل البيانات وتُؤكَّد.
              </p>
            </div>
            <Switch id="draft-mode" checked={draft} onCheckedChange={setDraft} />
          </div>

          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="mb-3 text-sm font-medium">
              {draft ? "2. ارفع الملف (سيُضاف كمسودة)" : "2. ارفع الملف بعد تعبئته"}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onUpload}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {fileName ?? "اختيار ملف Excel"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            الأعمدة: لينك صورة العرض · اسم المنتج · البراند · وصف المنتج · مميزات المنتج · مقاسات المنتج · لينك المنتج على الموقع · السعر · صور المنتج (درايف)
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
