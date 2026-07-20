"use client";

import { useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { importCustomersCSV, importItemsCSV, importSuppliersCSV, type ImportResult } from "@/app/actions/erp/csv-import";
import { importSalesOrdersCSV, importPurchaseOrdersCSV, importStockTransfersCSV } from "@/app/actions/erp/doc-import";
import type { DocImportResult } from "@/lib/erp/doc-import-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/icon";

const CUSTOMER_TEMPLATE = `code,nameAr,phone,email,creditLimit,paymentTerms
C001,شركة الأمل,01012345678,info@amal.com,50000,30
C002,مؤسسة النجاح,01123456789,,10000,15`;

const ITEMS_TEMPLATE = `code,nameAr,nameEn,sellPrice,minStock,description,isActive
ITM001,كرسي مكتبي,Office Chair,250.00,5,كرسي دوار مريح,true
ITM002,طاولة اجتماعات,Meeting Table,1200.00,2,,true`;

const SUPPLIERS_TEMPLATE = `code,nameAr,phone,email,address,paymentTerms
S001,مورد الشرق,01011122233,info@east.com,القاهرة,30
S002,شركة الإمداد,01233344455,,الإسكندرية,45`;

// Transactional templates: one row per line, grouped by the `ref` column.
const SALES_ORDER_TEMPLATE = `ref,date,customer,item,quantity,unitPrice
A1,2026-07-12,C001,ITM001,10,250
A1,2026-07-12,C001,ITM002,5,100
A2,2026-07-13,C002,ITM001,3,250`;

const PURCHASE_ORDER_TEMPLATE = `ref,date,supplier,warehouse,item,quantity,unitPrice
A1,2026-07-12,S001,المستودع الرئيسي,ITM001,20,180
A1,2026-07-12,S001,المستودع الرئيسي,ITM002,10,90
A2,2026-07-13,S002,المستودع الرئيسي,ITM001,15,175`;

const TRANSFER_TEMPLATE = `ref,date,item,quantity,fromWarehouse,toWarehouse,notes
A1,2026-07-12,ITM001,5,المستودع الرئيسي,فرع جدة,نقل تزويد
A1,2026-07-12,ITM002,3,المستودع الرئيسي,فرع جدة,
A2,2026-07-13,ITM001,2,فرع جدة,المستودع الرئيسي,مرتجع`;

function ResultBadge({ result }: { result: ImportResult }) {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-600"><Icon name="CheckCircle" className="size-4" />جديد: {result.inserted}</span>
        <span className="flex items-center gap-1 text-blue-600"><Icon name="RefreshCw" className="size-4" />تحديث: {result.updated}</span>
        {result.errors.length > 0 && <span className="flex items-center gap-1 text-destructive"><Icon name="AlertCircle" className="size-4" />أخطاء: {result.errors.length}</span>}
        <span className="text-muted-foreground">من إجمالي {result.total} صف</span>
      </div>
      {result.errors.length > 0 && (
        <ul className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1 max-h-40 overflow-y-auto">
          {result.errors.map((e) => <li key={e.row}>صف {e.row}: {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function DocResultBadge({ result }: { result: DocImportResult }) {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-600"><Icon name="CheckCircle" className="size-4" />مسودات أُنشئت: {result.created}</span>
        {result.errors.length > 0 && <span className="flex items-center gap-1 text-destructive"><Icon name="AlertCircle" className="size-4" />أخطاء: {result.errors.length}</span>}
        <span className="text-muted-foreground">من إجمالي {result.total} مستند</span>
      </div>
      {result.errors.length > 0 && (
        <ul className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1 max-h-40 overflow-y-auto">
          {result.errors.map((e, i) => <li key={i}>مرجع {e.ref}: {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function ImportPane<R>({
  description, template, templateName, onImport, successCount, renderResult, draftNote,
}: {
  description: string; template: string; templateName: string;
  onImport: (csv: string) => Promise<R | { error: string }>;
  successCount: (r: R) => number;
  renderResult: (r: R) => React.ReactNode;
  draftNote?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<R | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handle = (text: string) => {
    start(async () => {
      setResult(null);
      const r = await onImport(text);
      if (r && typeof r === "object" && "error" in r) { toast.error((r as { error: string }).error); return; }
      setResult(r as R);
      const n = successCount(r as R);
      if (n > 0) toast.success(`تم استيراد ${n}`);
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
      {draftNote && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" /><span>{draftNote}</span>
        </div>
      )}

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
        <p className="text-xs text-muted-foreground">UTF-8</p>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />

      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" className="size-4 animate-spin" />جارٍ المعالجة...
        </div>
      )}
      {result && renderResult(result)}
    </div>
  );
}

const masterProps = { successCount: (r: ImportResult) => r.inserted + r.updated, renderResult: (r: ImportResult) => <ResultBadge result={r} /> };
const docProps = { successCount: (r: DocImportResult) => r.created, renderResult: (r: DocImportResult) => <DocResultBadge result={r} /> };
const DRAFT_NOTE = "تُنشأ المستندات كمسودات فقط — راجعها ثم أكّدها يدويًا حتى تُرحَّل للمخزون والمحاسبة. صفوف بنفس «ref» تُجمَّع في مستند واحد.";

export function CsvImportClient() {
  return (
    <Tabs defaultValue="customers">
      <TabsList className="flex-wrap">
        <TabsTrigger value="customers">العملاء</TabsTrigger>
        <TabsTrigger value="suppliers">الموردون</TabsTrigger>
        <TabsTrigger value="items">الأصناف</TabsTrigger>
        <TabsTrigger value="sales-orders">أوامر البيع</TabsTrigger>
        <TabsTrigger value="purchase-orders">أوامر الشراء</TabsTrigger>
        <TabsTrigger value="transfers">التحويلات</TabsTrigger>
      </TabsList>

      <TabsContent value="customers">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد العملاء</CardTitle><CardDescription>الأعمدة: code, nameAr, phone, email, creditLimit, paymentTerms</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...masterProps} description="استيراد أو تحديث بيانات العملاء. الموجود (بنفس الكود) سيتم تحديثه." template={CUSTOMER_TEMPLATE} templateName="customers-template.csv" onImport={importCustomersCSV} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="suppliers">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد الموردين</CardTitle><CardDescription>الأعمدة: code, nameAr, phone, email, address, paymentTerms</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...masterProps} description="استيراد أو تحديث بيانات الموردين. الموجود (بنفس الكود) سيتم تحديثه دون المساس بالأرصدة." template={SUPPLIERS_TEMPLATE} templateName="suppliers-template.csv" onImport={importSuppliersCSV} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="items">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد الأصناف</CardTitle><CardDescription>الأعمدة: code, nameAr, nameEn, sellPrice, minStock, description, isActive</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...masterProps} description="استيراد أو تحديث بيانات الأصناف. الموجود (بنفس الكود) سيتم تحديثه دون المساس بأرصدة المخزون." template={ITEMS_TEMPLATE} templateName="items-template.csv" onImport={importItemsCSV} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="sales-orders">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد أوامر البيع (مسودات)</CardTitle><CardDescription>الأعمدة: ref, date, customer, item, quantity, unitPrice — العميل والصنف بالكود</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...docProps} draftNote={DRAFT_NOTE} description="ينشئ أوامر بيع مسودة من ملف CSV. صفوف بنفس المرجع = أمر واحد بعدة بنود." template={SALES_ORDER_TEMPLATE} templateName="sales-orders-template.csv" onImport={importSalesOrdersCSV} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="purchase-orders">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد أوامر الشراء (مسودات)</CardTitle><CardDescription>الأعمدة: ref, date, supplier, warehouse, item, quantity, unitPrice — المورد/الصنف بالكود، المستودع بالكود أو الاسم</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...docProps} draftNote={DRAFT_NOTE} description="ينشئ أوامر شراء مسودة من ملف CSV. صفوف بنفس المرجع = أمر واحد بعدة بنود." template={PURCHASE_ORDER_TEMPLATE} templateName="purchase-orders-template.csv" onImport={importPurchaseOrdersCSV} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="transfers">
        <Card className="mt-4">
          <CardHeader><CardTitle>استيراد التحويلات المخزنية (مسودات)</CardTitle><CardDescription>الأعمدة: ref, date, item, quantity, fromWarehouse, toWarehouse, notes — الصنف بالكود، المستودعات بالكود أو الاسم</CardDescription></CardHeader>
          <CardContent>
            <ImportPane {...docProps} draftNote={DRAFT_NOTE} description="ينشئ تحويلات مخزنية مسودة من ملف CSV. صفوف بنفس المرجع = تحويل واحد بعدة بنود." template={TRANSFER_TEMPLATE} templateName="transfers-template.csv" onImport={importStockTransfersCSV} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
