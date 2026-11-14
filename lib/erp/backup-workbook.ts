import { gunzipSync } from "node:zlib";
import * as XLSX from "xlsx";

type Row = Record<string, unknown>;
type Payload = { meta: { orgId: string; orgName: string; exportedAt: string }; data: Record<string, Row[]> };
const TABLES: Record<string, string> = {
  items: "الأصناف", item_codes: "أكواد الأصناف", item_categories: "فئات الأصناف", item_units: "وحدات الأصناف",
  customers: "العملاء", suppliers: "الموردون", warehouses: "المخازن", currencies: "العملات", exchange_rates: "أسعار الصرف", units_of_measure: "وحدات القياس",
  accounts: "دليل الحسابات", journal_entries: "القيود المحاسبية", journal_entry_lines: "بنود القيود", stock_movements: "حركات المخزون",
  sales_orders: "أوامر البيع", sales_order_lines: "بنود أوامر البيع", sales_invoices: "فواتير البيع", sales_invoice_lines: "بنود فواتير البيع",
  sales_returns: "مرتجعات البيع", sales_return_lines: "بنود مرتجعات البيع", purchase_orders: "أوامر الشراء", purchase_order_lines: "بنود أوامر الشراء",
  purchase_invoices: "فواتير الشراء", purchase_invoice_lines: "بنود فواتير الشراء", goods_receipts: "إذون الاستلام", goods_receipt_lines: "بنود إذون الاستلام",
  receipt_vouchers: "سندات القبض", payment_vouchers: "سندات الصرف", bank_accounts: "الحسابات البنكية", employees: "الموظفون", attendance: "الحضور",
  sales_platforms: "منصات البيع", projects: "المشروعات", timesheets: "ساعات العمل", fixed_assets: "الأصول الثابتة", stock_transfers: "تحويلات المخزون",
  inventory_audits: "الجرد", inventory_audit_lines: "بنود الجرد", price_lists: "قوائم الأسعار", price_list_items: "أسعار الأصناف", document_attachments: "فهرس المرفقات",
};
const COLUMNS: Record<string, string> = {
  id: "المعرّف الداخلي", code: "الكود", number: "الرقم", name_ar: "الاسم", name_en: "الاسم بالإنجليزية", name: "الاسم", description: "الوصف", notes: "ملاحظات",
  date: "التاريخ", created_at: "تاريخ الإنشاء", updated_at: "آخر تعديل", status: "الحالة", is_active: "نشط", phone: "الهاتف", email: "البريد الإلكتروني", address: "العنوان",
  quantity: "الكمية", unit_price: "سعر الوحدة", sell_price: "سعر البيع", purchase_cost: "تكلفة الشراء", unit_cost: "تكلفة الوحدة", total_amount: "الإجمالي", amount: "المبلغ",
  discount_amount: "قيمة الخصم", tax_amount: "قيمة الضريبة", vat_rate: "نسبة الضريبة", total: "الإجمالي", subtotal: "الإجمالي قبل الضريبة", balance: "الرصيد",
  debit: "مدين", credit: "دائن", balance_quantity: "رصيد الكمية", balance_value: "قيمة الرصيد", min_stock: "حد المخزون الأدنى", max_stock: "حد المخزون الأعلى",
  customer_id: "العميل", supplier_id: "المورد", item_id: "الصنف", warehouse_id: "المخزن", currency_id: "العملة", unit_id: "الوحدة", account_id: "الحساب",
  sales_order_id: "أمر البيع", purchase_order_id: "أمر الشراء", sales_invoice_id: "فاتورة البيع", purchase_invoice_id: "فاتورة الشراء", journal_entry_id: "القيد",
  employee_id: "الموظف", platform_id: "المنصة", image: "رابط الصورة", code_type: "نوع الكود", normalized_code: "الكود الموحّد", is_primary: "أساسي",
  file_name: "اسم الملف", file_size: "حجم الملف", entity_type: "نوع المستند", entity_id: "معرّف المستند", tax_number: "الرقم الضريبي", credit_limit: "حد الائتمان",
  payment_terms: "مدة السداد", due_date: "تاريخ الاستحقاق", exchange_rate: "سعر الصرف", received_quantity: "الكمية المستلمة", delivered_quantity: "الكمية المسلمة",
};
const REFERENCES: Record<string, string> = {
  customer_id: "customers", supplier_id: "suppliers", item_id: "items", parent_item_id: "items", warehouse_id: "warehouses", from_warehouse_id: "warehouses", to_warehouse_id: "warehouses",
  currency_id: "currencies", unit_id: "units_of_measure", account_id: "accounts", gl_account_id: "accounts", bank_account_id: "bank_accounts", category_id: "item_categories",
  sales_order_id: "sales_orders", purchase_order_id: "purchase_orders", sales_invoice_id: "sales_invoices", purchase_invoice_id: "purchase_invoices", journal_entry_id: "journal_entries", employee_id: "employees", platform_id: "sales_platforms",
};
const SECRET = /password|secret|token|credential|api_key|recovery_code|totp|private_key/i;
const pretty = (value: string) => value.replace(/_/g, " ").replace(/\b[a-z]/g, c => c.toUpperCase());

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key)).map(([key, v]) => [key, scrub(v)]));
  return value;
}

/** A readable companion generated from the exact JSON backup, without new DB queries. */
export function buildBackupWorkbook(buffer: Buffer, expectedOrgId: string, locale: "ar" | "en" = "ar") {
  const payload = JSON.parse(gunzipSync(buffer).toString("utf8")) as Payload;
  if (payload.meta?.orgId !== expectedOrgId || !payload.data || typeof payload.data !== "object") throw new Error("Backup organization mismatch");
  for (const rows of Object.values(payload.data)) {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || ("organization_id" in row && row.organization_id !== expectedOrgId))) throw new Error("Foreign organization in backup");
  }
  const ar = locale === "ar";
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: ar }] };
  const tableNames = Object.keys(payload.data).filter(table => !SECRET.test(table) && !/^mcp_|^storage_cloud_/i.test(table));
  tableNames.sort((a, b) => Number(!(a in TABLES)) - Number(!(b in TABLES)) || a.localeCompare(b));
  const indexes = new Map<string, Map<unknown, string>>();
  for (const table of tableNames) indexes.set(table, new Map(payload.data[table].map(row => [row.id, [row.code || row.number, row.name_ar || row.name_en || row.name].filter(v => typeof v === "string" && v).join(" · ")]).filter((entry): entry is [unknown, string] => !!entry[0] && !!entry[1])));
  const names = new Set<string>();
  function uniqueName(title: string) {
    const base = title.replace(/[\\/*?:\[\]]/g, " ").trim() || "Data";
    let name = base.slice(0, 31), n = 2;
    while (names.has(name.toLowerCase())) { const suffix = ` ${n++}`; name = base.slice(0, 31 - suffix.length) + suffix; }
    names.add(name.toLowerCase()); return name;
  }
  const summaryName = uniqueName(ar ? "ملخص النسخة" : "Backup summary");
  const summaries: (string | number)[][] = [];
  let cells = 0, totalRows = 0, truncatedCells = 0;
  const sheets: { name: string; ws: XLSX.WorkSheet }[] = [];
  for (const table of tableNames) {
    const rows = payload.data[table];
    const label = ar ? TABLES[table] || pretty(table) : pretty(table);
    if (!rows.length) { summaries.push([label, table, 0, "—"]); continue; }
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => key !== "organization_id" && !SECRET.test(key));
    columns.sort((a, b) => Number(a === "id") - Number(b === "id"));
    cells += (rows.length + 1) * columns.length;
    if (cells > 5000000 || rows.length > 1000000) throw new Error("Readable backup exceeds spreadsheet limits");
    const aoa: (string | number)[][] = [columns.map(key => ar ? COLUMNS[key] || pretty(key) : pretty(key))];
    for (const row of rows) aoa.push(columns.map(key => {
      let value = row[key];
      const resolved = REFERENCES[key] && indexes.get(REFERENCES[key])?.get(value);
      if (resolved) value = resolved;
      if (value == null) return "";
      if (typeof value === "boolean") return ar ? value ? "نعم" : "لا" : value ? "Yes" : "No";
      if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
      if (typeof value === "object") value = JSON.stringify(scrub(value));
      const text = String(value);
      // Keep codes, barcodes and high precision amounts as text; never create formulas.
      if (/(?:amount|price|cost|quantity|qty|rate|balance|debit|credit|total|stock|value)$/.test(key) && /^-?\d+(\.\d+)?$/.test(text) && text.replace(/[^0-9]/g, "").length <= 15) return Number(text);
      if (text.length > 32700) { truncatedCells++; return text.slice(0, 32698) + " …"; }
      return text;
    }));
    const name = uniqueName(label), ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!autofilter"] = { ref: ws["!ref"]! };
    ws["!cols"] = columns.map(key => ({ wch: /name|description|notes/.test(key) ? 36 : key === "id" || /_id$/.test(key) ? 30 : 20 }));
    summaries.push([label, table, rows.length, name]); totalRows += rows.length; sheets.push({ name, ws });
  }
  const summary = XLSX.utils.aoa_to_sheet([
    [ar ? "المؤسسة" : "Organization", payload.meta.orgName],
    [ar ? "تاريخ النسخة" : "Exported at", payload.meta.exportedAt],
    [ar ? "عدد السجلات المعروضة" : "Readable records", totalRows],
    [ar ? "الخلايا الطويلة المختصرة" : "Long cells shortened", truncatedCells],
    [ar ? "ملاحظة" : "Note", ar ? "نسخة للقراءة من نفس ملف JSON. تبقى JSON المرجع الكامل للاستعادة؛ المرفقات والأسرار غير مضمنة في الجداول." : "Readable companion of the same JSON snapshot. JSON remains the full restore source; attachment binaries and secrets are not included in these sheets."],
    [], [ar ? "البيانات" : "Dataset", ar ? "الجدول الأصلي" : "Source table", ar ? "عدد السجلات" : "Records", ar ? "التبويب" : "Sheet"], ...summaries,
  ]);
  summary["!cols"] = [{ wch: 32 }, { wch: 48 }, { wch: 20 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, summary, summaryName);
  for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.name);
  return { buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer, sheetCount: sheets.length, totalRows, truncatedCells };
}

/** One independent spreadsheet per dataset, plus a separate snapshot index. */
export function buildBackupSheets(buffer: Buffer, expectedOrgId: string, locale: "ar" | "en" = "ar") {
  const combined = buildBackupWorkbook(buffer, expectedOrgId, locale);
  const source = XLSX.read(combined.buffer, { type: "buffer", cellStyles: true });
  const files = source.SheetNames.map((name, index) => {
    const book = XLSX.utils.book_new();
    book.Workbook = { Views: [{ RTL: locale === "ar" }] };
    const sheet = source.Sheets[name];
    if (index === 0 && sheet.D7) sheet.D7.v = locale === "ar" ? "ملف البيانات" : "Data file";
    XLSX.utils.book_append_sheet(book, sheet, name);
    return { name, buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer };
  });
  return { files, sheetCount: combined.sheetCount, totalRows: combined.totalRows, truncatedCells: combined.truncatedCells };
}

export function backupFolderName(exportedAt: string) {
  const date = new Date(exportedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid backup date");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}-${parts.second}`;
}
