"use client";

import { useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { importCustomersCSV, importItemsCSV, type ImportResult } from "@/app/actions/erp/csv-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/icon";

const CUSTOMER_TEMPLATE = `code,nameAr,phone,email,creditLimit,paymentTerms
C001,شركة الأمل,0501234567,info@amal.sa,50000,30
C002,مؤسسة النجاح,0551234567,,10000,15`;

const ITEMS_TEMPLATE = `code,nameAr,nameEn,sellPrice,minStock,description,isActive
ITM001,كرسي مكتبي,Office Chair,250.00,5,كرسي دوار مريح,true
ITM002,طاولة اجتماعات,Meeting Table,1200.00,2,,true`;

function ResultBadge({ result }: { result: ImportResult }) {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-600">
          <Icon name="CheckCircle" className="size-4" />جديد: {result.inserted}
        </span>
        <span className="flex items-center gap-1 text-blue-600">
          <Icon name="RefreshCw" className="size-4" />تحديث: {result.updated}
        </span>
        {result.errors.length > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <Icon name="AlertCircle" className="size-4" />أخطاء: {result.errors.length}
          </span>
        )}
        <span className="text-muted-foreground">من إجمالي {result.total} صف</span>
      </div>
      {result.errors.length > 0 && (
        <ul className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1 max-h-40 overflow-y-auto">
          {result.errors.map((e) => (
            <li key={e.row}>صف {e.row}: {e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportPane({
  title, description, template, templateName, onImport,
}: {
  title: string; description: string; template: string; templateName: string;
  onImport: (csv: string) => Promise<ImportResult | { error: string }>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handle = (text: string) => {
    start(async () => {
      setResult(null);
      const r = await onImport(text);
      if ("error" in r) { toast.error(r.error); return; }
      setResult(r);
      if (r.inserted + r.updated > 0) toast.success(`تم استيراد ${r.inserted + r.updated} سجل`);
      if (r.errors.length > 0) toast.warning(`${r.errors.length} صف بها أخطاء`);
    });
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => handle(e.target?.result as string);
    reader.readAsText(file, "utf-8");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{description}</p>

      {/* Download template */}
      <Button
        variant="outline" size="sm"
        onClick={() => {
          const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = templateName; a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Icon name="Download" className="size-4" />تحميل نموذج CSV
      </Button>

      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer
          ${dragOver ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        onClick={() => fileRef.current?.click()}
      >
        <Icon name="Upload" className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">اسحب ملف CSV هنا أو انقر للاختيار</p>
        <p className="text-xs text-muted-foreground">UTF-8 · حد الصفوف: 5,000</p>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />

      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" className="size-4 animate-spin" />جارٍ المعالجة...
        </div>
      )}
      {result && <ResultBadge result={result} />}
    </div>
  );
}

export function CsvImportClient() {
  return (
    <Tabs defaultValue="customers">
      <TabsList>
        <TabsTrigger value="customers">العملاء</TabsTrigger>
        <TabsTrigger value="items">الأصناف</TabsTrigger>
      </TabsList>

      <TabsContent value="customers">
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>استيراد العملاء</CardTitle>
            <CardDescription>الأعمدة: code, nameAr, phone, email, creditLimit, paymentTerms</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportPane
              title="العملاء"
              description="استيراد أو تحديث بيانات العملاء. الأصناف الموجودة (بنفس الكود) سيتم تحديثها."
              template={CUSTOMER_TEMPLATE}
              templateName="customers-template.csv"
              onImport={importCustomersCSV}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="items">
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>استيراد الأصناف</CardTitle>
            <CardDescription>الأعمدة: code, nameAr, nameEn, sellPrice, minStock, description, isActive</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportPane
              title="الأصناف"
              description="استيراد أو تحديث بيانات الأصناف. الأصناف الموجودة (بنفس الكود) سيتم تحديثها دون المساس بأرصدة المخزون."
              template={ITEMS_TEMPLATE}
              templateName="items-template.csv"
              onImport={importItemsCSV}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
