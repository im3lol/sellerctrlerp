import "server-only";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers, suppliers, items, salesOrders, purchaseOrders, stockTransfers, salesInvoices, purchaseInvoices,
  posShifts, promotions, workOrders, fixedAssets, fuelLogs, projects, timesheets, employees,
  jobOpenings, jobApplicants, trainingCourses,
} from "@/db/schema";

// One place that describes every exportable dataset: its Arabic title, the module
// permission that guards it, the column headers, and a read-only fetcher. Both the
// Excel route and the print (→ PDF) view render from this — add a dataset once, get
// both formats. Everything here is read-only (safe); nothing writes to GL/stock.

export type Cell = string | number | null | undefined;
export type ModuleKey = "sales.view" | "purchases.view" | "inventory.view" | "accounting.view";

export type ExportDataset = {
  title: string;
  module: ModuleKey;
  headers: string[];
  colWidths?: number[];
  fetch: (orgId: string) => Promise<Cell[][]>;
};

const yn = (b: boolean | null) => (b ? "نعم" : "لا");
const d10 = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const num = (v: string | number | null) => Number(v ?? 0);

const STATUS_AR: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "تم الاستلام",
  INVOICED: "مفوتر", CANCELLED: "ملغى", POSTED: "مُرحّل", PARTIAL_PAID: "مدفوع جزئيًا", PAID: "مدفوع",
  SHIPPED: "مشحون", DELIVERED: "مُسلّم", COMPLETED: "مكتمل", APPROVED: "معتمد", REJECTED: "مرفوض", SENT: "مُرسل",
};
const st = (s: string | null) => (s ? STATUS_AR[s] ?? s : "");

// The newer modules carry their own vocabularies; exporting raw enum names would hand
// the owner a spreadsheet of English constants.
const PROMO_TYPE: Record<string, string> = { PERCENT: "نسبة", AMOUNT: "مبلغ لكل قطعة", BUY_X_GET_Y: "اشترِ واحصل" };
const WO_STATUS: Record<string, string> = { DRAFT: "مفتوح", IN_PROGRESS: "شغّال", DONE: "مقفول", CANCELLED: "ملغي" };
const PROJECT_STATUS: Record<string, string> = { DRAFT: "مسودة", ACTIVE: "شغّال", ON_HOLD: "متوقّف", DONE: "مقفول", CANCELLED: "ملغي" };
const STAGE: Record<string, string> = { APPLIED: "قدّم", SCREENING: "فرز", INTERVIEW: "مقابلة", OFFER: "عرض", HIRED: "اتعيّن", REJECTED: "مرفوض" };
const COURSE_STATUS: Record<string, string> = { PLANNED: "مخطّطة", RUNNING: "شغّالة", DONE: "خلصت", CANCELLED: "ملغية" };

export const EXPORT_DATASETS: Record<string, ExportDataset> = {
  customers: {
    title: "العملاء", module: "sales.view",
    headers: ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "حد الائتمان", "مدة السداد", "نشط"],
    colWidths: [14, 28, 16, 22, 24, 14, 14, 12, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(customers).where(eq(customers.organizationId, orgId)).orderBy(customers.code);
      return rows.map((c) => [c.code, c.nameAr, c.phone, c.email, c.address, num(c.balance), num(c.creditLimit), c.paymentTerms, yn(c.isActive)]);
    },
  },
  suppliers: {
    title: "الموردون", module: "purchases.view",
    headers: ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "مدة السداد", "نشط"],
    colWidths: [14, 28, 16, 22, 24, 14, 12, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(suppliers.code);
      return rows.map((s) => [s.code, s.nameAr, s.phone, s.email, s.address, num(s.balance), s.paymentTerms, yn(s.isActive)]);
    },
  },
  items: {
    title: "الأصناف", module: "inventory.view",
    headers: ["الكود", "الاسم", "سعر البيع", "أقل مخزون", "أعلى مخزون", "قابل للتلف", "نشط"],
    colWidths: [16, 28, 12, 12, 12, 10, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(items).where(eq(items.organizationId, orgId)).orderBy(items.code);
      return rows.map((i) => [i.code, i.nameAr, num(i.sellPrice), num(i.minStock), i.maxStock == null ? "" : num(i.maxStock), yn(i.isPerishable), yn(i.isActive)]);
    },
  },
  "sales-orders": {
    title: "أوامر البيع", module: "sales.view",
    headers: ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي"],
    colWidths: [18, 12, 28, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: salesOrders.number, date: salesOrders.date, party: customers.nameAr, status: salesOrders.status, total: salesOrders.totalAmount })
        .from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
        .where(eq(salesOrders.organizationId, orgId)).orderBy(desc(salesOrders.date), desc(salesOrders.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total)]);
    },
  },
  "purchase-orders": {
    title: "أوامر الشراء", module: "purchases.view",
    headers: ["الرقم", "التاريخ", "المورد", "الحالة", "الإجمالي"],
    colWidths: [18, 12, 28, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: purchaseOrders.number, date: purchaseOrders.date, party: suppliers.nameAr, status: purchaseOrders.status, total: purchaseOrders.totalAmount })
        .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(eq(purchaseOrders.organizationId, orgId)).orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total)]);
    },
  },
  "stock-transfers": {
    title: "التحويلات المخزنية", module: "inventory.view",
    headers: ["الرقم", "التاريخ", "الحالة", "ملاحظات"],
    colWidths: [18, 12, 14, 40],
    fetch: async (orgId) => {
      const rows = await db.select().from(stockTransfers).where(eq(stockTransfers.organizationId, orgId)).orderBy(desc(stockTransfers.date), desc(stockTransfers.number));
      return rows.map((t) => [t.number, d10(t.date), st(t.status), t.notes]);
    },
  },
  "sales-invoices": {
    title: "فواتير البيع", module: "sales.view",
    headers: ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي", "المسدد", "المتبقي"],
    colWidths: [18, 12, 28, 14, 14, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: salesInvoices.number, date: salesInvoices.date, party: customers.nameAr, status: salesInvoices.status, total: salesInvoices.totalAmount, paid: salesInvoices.paidAmount, due: salesInvoices.balanceDue })
        .from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
        .where(eq(salesInvoices.organizationId, orgId)).orderBy(desc(salesInvoices.date), desc(salesInvoices.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total), num(r.paid), num(r.due)]);
    },
  },
  "purchase-invoices": {
    title: "فواتير الشراء", module: "purchases.view",
    headers: ["الرقم", "التاريخ", "المورد", "الحالة", "الإجمالي", "المسدد", "المتبقي"],
    colWidths: [18, 12, 28, 14, 14, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: purchaseInvoices.number, date: purchaseInvoices.date, party: suppliers.nameAr, status: purchaseInvoices.status, total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, due: purchaseInvoices.balanceDue })
        .from(purchaseInvoices).leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .where(eq(purchaseInvoices.organizationId, orgId)).orderBy(desc(purchaseInvoices.date), desc(purchaseInvoices.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total), num(r.paid), num(r.due)]);
    },
  },
  // ── the modules added after the first eight ────────────────────────────
  // A feature that cannot be exported is a feature the owner cannot take to their
  // accountant — and since the report builder reads this same registry, adding a
  // dataset here also puts the module into the builder and the reports centre.

  "pos-shifts": {
    title: "ورديات نقطة البيع", module: "sales.view",
    headers: ["الرقم", "الكاشير", "الفتح", "الإقفال", "رصيد افتتاحي", "متوقّع", "معدود", "الفرق", "الحالة"],
    colWidths: [16, 22, 18, 18, 14, 14, 14, 14, 12],
    fetch: async (orgId) => {
      const rows = await db.select({
        number: posShifts.number, userName: posShifts.userName, openedAt: posShifts.openedAt,
        closedAt: posShifts.closedAt, opening: posShifts.openingFloat,
        expected: posShifts.expectedCash, counted: posShifts.countedCash,
        diff: posShifts.difference, status: posShifts.status,
      }).from(posShifts).where(eq(posShifts.organizationId, orgId)).orderBy(desc(posShifts.openedAt));
      return rows.map((r) => [
        r.number, r.userName, d10(r.openedAt), d10(r.closedAt), num(r.opening),
        r.expected == null ? "" : num(r.expected),
        r.counted == null ? "" : num(r.counted),
        r.diff == null ? "" : num(r.diff),
        st(r.status),
      ]);
    },
  },
  promotions: {
    title: "العروض", module: "sales.view",
    headers: ["الكود", "الاسم", "النوع", "القيمة", "الصنف", "من", "إلى", "مفعّل"],
    colWidths: [14, 28, 16, 12, 24, 12, 12, 8],
    fetch: async (orgId) => {
      const rows = await db.select({
        code: promotions.code, nameAr: promotions.nameAr, type: promotions.type,
        value: promotions.value, item: items.nameAr,
        startsAt: promotions.startsAt, endsAt: promotions.endsAt, active: promotions.isActive,
      }).from(promotions).leftJoin(items, eq(items.id, promotions.itemId))
        .where(eq(promotions.organizationId, orgId)).orderBy(promotions.code);
      return rows.map((r) => [r.code, r.nameAr, PROMO_TYPE[r.type] ?? r.type, num(r.value), r.item ?? "الفاتورة كلها", r.startsAt, r.endsAt, yn(r.active)]);
    },
  },
  "work-orders": {
    title: "أوامر الصيانة", module: "accounting.view",
    headers: ["الرقم", "الأصل", "النوع", "الحالة", "البلاغ", "الإقفال", "قطع غيار", "ساعات عمل", "توقّف (ساعة)", "الوصف"],
    colWidths: [16, 26, 12, 12, 12, 12, 14, 12, 12, 40],
    fetch: async (orgId) => {
      const rows = await db.select({
        number: workOrders.number, asset: fixedAssets.nameAr, type: workOrders.type,
        status: workOrders.status, reportedAt: workOrders.reportedAt, completedAt: workOrders.completedAt,
        parts: workOrders.partsCost, hours: workOrders.laborHours, downtime: workOrders.downtimeHours,
        description: workOrders.description,
      }).from(workOrders).leftJoin(fixedAssets, eq(fixedAssets.id, workOrders.assetId))
        .where(eq(workOrders.organizationId, orgId)).orderBy(desc(workOrders.reportedAt));
      return rows.map((r) => [
        r.number, r.asset, r.type === "PREVENTIVE" ? "دورية" : "عطل", WO_STATUS[r.status] ?? r.status,
        d10(r.reportedAt), d10(r.completedAt), num(r.parts), num(r.hours), num(r.downtime), r.description,
      ]);
    },
  },
  "fuel-logs": {
    title: "تعبئات الوقود", module: "accounting.view",
    headers: ["التاريخ", "السيارة", "اللوحة", "اللترات", "التكلفة", "العدّاد", "المحطة", "السائق"],
    colWidths: [12, 26, 14, 12, 14, 14, 20, 22],
    fetch: async (orgId) => {
      const rows = await db.select({
        filledAt: fuelLogs.filledAt, asset: fixedAssets.nameAr, plate: fixedAssets.plateNumber,
        liters: fuelLogs.liters, cost: fuelLogs.cost, meter: fuelLogs.meterValue,
        station: fuelLogs.station, driver: employees.fullName,
      }).from(fuelLogs)
        .leftJoin(fixedAssets, eq(fixedAssets.id, fuelLogs.assetId))
        .leftJoin(employees, eq(employees.id, fuelLogs.driverEmployeeId))
        .where(eq(fuelLogs.organizationId, orgId)).orderBy(desc(fuelLogs.filledAt));
      return rows.map((r) => [d10(r.filledAt), r.asset, r.plate, num(r.liters), num(r.cost), r.meter == null ? "" : num(r.meter), r.station, r.driver]);
    },
  },
  projects: {
    title: "المشاريع", module: "accounting.view",
    headers: ["الكود", "الاسم", "العميل", "الحالة", "من", "إلى", "الميزانية"],
    colWidths: [14, 30, 26, 12, 12, 12, 14],
    fetch: async (orgId) => {
      const rows = await db.select({
        code: projects.code, nameAr: projects.nameAr, customer: customers.nameAr,
        status: projects.status, startDate: projects.startDate, endDate: projects.endDate,
        budget: projects.budget,
      }).from(projects).leftJoin(customers, eq(customers.id, projects.customerId))
        .where(eq(projects.organizationId, orgId)).orderBy(projects.code);
      return rows.map((r) => [r.code, r.nameAr, r.customer ?? "داخلي", PROJECT_STATUS[r.status] ?? r.status, r.startDate, r.endDate, num(r.budget)]);
    },
  },
  timesheets: {
    title: "ساعات العمل", module: "accounting.view",
    headers: ["التاريخ", "المشروع", "الموظف", "الساعات", "تكلفة الساعة", "سعر الساعة", "تتفوتر", "اتفوترت"],
    colWidths: [12, 28, 24, 10, 14, 14, 10, 10],
    fetch: async (orgId) => {
      const rows = await db.select({
        workDate: timesheets.workDate, project: projects.nameAr, employee: employees.fullName,
        hours: timesheets.hours, costRate: timesheets.costRate, billRate: timesheets.billRate,
        billable: timesheets.billable, invoicedAt: timesheets.invoicedAt,
      }).from(timesheets)
        .leftJoin(projects, eq(projects.id, timesheets.projectId))
        .leftJoin(employees, eq(employees.id, timesheets.employeeId))
        .where(eq(timesheets.organizationId, orgId)).orderBy(desc(timesheets.workDate));
      return rows.map((r) => [r.workDate, r.project, r.employee, num(r.hours), num(r.costRate), num(r.billRate), yn(r.billable), yn(!!r.invoicedAt)]);
    },
  },
  applicants: {
    title: "المتقدّمون للوظائف", module: "accounting.view",
    headers: ["الوظيفة", "الاسم", "الهاتف", "البريد", "المصدر", "المرحلة", "تاريخ التقديم", "الراتب المتوقّع"],
    colWidths: [26, 26, 16, 24, 16, 12, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({
        opening: jobOpenings.titleAr, fullName: jobApplicants.fullName,
        phone: jobApplicants.phone, email: jobApplicants.email, source: jobApplicants.source,
        stage: jobApplicants.stage, appliedAt: jobApplicants.appliedAt, expected: jobApplicants.expectedSalary,
      }).from(jobApplicants).leftJoin(jobOpenings, eq(jobOpenings.id, jobApplicants.openingId))
        .where(eq(jobApplicants.organizationId, orgId)).orderBy(desc(jobApplicants.appliedAt));
      return rows.map((r) => [r.opening, r.fullName, r.phone, r.email, r.source, STAGE[r.stage] ?? r.stage, d10(r.appliedAt), num(r.expected)]);
    },
  },
  "training-courses": {
    title: "الكورسات التدريبية", module: "accounting.view",
    headers: ["الكود", "الاسم", "الجهة", "من", "إلى", "ساعات", "تكلفة المقعد", "المقاعد", "الحالة"],
    colWidths: [14, 30, 22, 12, 12, 10, 14, 10, 12],
    fetch: async (orgId) => {
      const rows = await db.select().from(trainingCourses)
        .where(eq(trainingCourses.organizationId, orgId)).orderBy(trainingCourses.code);
      return rows.map((c) => [c.code, c.nameAr, c.provider, c.startsAt, c.endsAt, num(c.hours), num(c.costPerSeat), c.seats, COURSE_STATUS[c.status] ?? c.status]);
    },
  },
};

export const EXPORT_ORDER = [
  "items", "customers", "suppliers", "sales-orders", "purchase-orders", "stock-transfers", "sales-invoices", "purchase-invoices",
  "pos-shifts", "promotions", "work-orders", "fuel-logs", "projects", "timesheets", "applicants", "training-courses",
] as const;
