import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { syncDocumentSequences } from "@/lib/erp/sequence";
import {
  users,
  workspaces,
  workspaceMembers,
  productStatuses,
  products,
  productBases,
  tasks,
  attendance,
  organizations,
  organizationMembers,
  accounts,
  customers,
  suppliers,
  investors,
  items as itemsTable,
  itemCodes,
  accountingJournals,
  fiscalPeriods,
  salesInvoices,
  salesInvoiceLines,
  warehouses,
  purchaseInvoices,
  purchaseInvoiceLines,
  journalEntries,
  journalEntryLines,
  costCenters,
  stockMovements,
  stockTransfers,
  stockTransferLines,
  stockAdjustments,
  documentSequences,
  auditLogs,
  receiptVouchers,
  paymentVouchers,
  salesReturns,
  salesReturnLines,
  purchaseReturns,
  purchaseReturnLines,
  salesOrders,
  salesOrderLines,
  purchaseOrders,
  purchaseOrderLines,
  deliveryNotes,
  deliveryNoteLines,
  purchaseReceipts,
  purchaseReceiptLines,
} from "@/db/schema";

/**
 * Demo seed. Idempotent: clears the relevant tables, then inserts a clear,
 * testable scenario — 2 employees + 2 clients, each with their own products
 * in different statuses. Run with: npm run db:seed
 */
async function main() {
  console.log("🌱 Seeding SellerCtrl demo…");

  await db.delete(attendance);
  await db.delete(tasks);
  await db.delete(products);
  await db.delete(workspaceMembers);
  await db.delete(productStatuses);
  await db.delete(workspaces);
  // ERP tables — children first to satisfy FKs (don't rely on cascade ordering).
  await db.delete(journalEntryLines);
  await db.delete(journalEntries);
  await db.delete(receiptVouchers);
  await db.delete(paymentVouchers);
  await db.delete(salesReturnLines);
  await db.delete(salesReturns);
  await db.delete(purchaseReturnLines);
  await db.delete(purchaseReturns);
  await db.delete(deliveryNoteLines);
  await db.delete(deliveryNotes);
  await db.delete(purchaseReceiptLines);
  await db.delete(purchaseReceipts);
  await db.delete(salesOrderLines);
  await db.delete(salesOrders);
  await db.delete(purchaseOrderLines);
  await db.delete(purchaseOrders);
  await db.delete(costCenters);
  await db.delete(stockTransferLines);
  await db.delete(stockTransfers);
  await db.delete(stockAdjustments);
  await db.delete(stockMovements);
  await db.delete(salesInvoiceLines);
  await db.delete(salesInvoices);
  await db.delete(purchaseInvoiceLines);
  await db.delete(purchaseInvoices);
  await db.delete(accounts);
  await db.delete(itemCodes);
  await db.delete(itemsTable);
  await db.delete(customers);
  await db.delete(suppliers);
  await db.delete(investors);
  await db.delete(warehouses);
  await db.delete(accountingJournals);
  await db.delete(fiscalPeriods);
  await db.delete(auditLogs);
  await db.delete(documentSequences);
  await db.delete(organizationMembers);
  await db.delete(organizations);
  await db.delete(users);

  const pw = await bcrypt.hash("password123", 10);
  const mk = (name: string, email: string, role: "system_admin" | "ops_manager" | "team_lead" | "employee" | "client", title?: string) =>
    ({ name, email, passwordHash: pw, role, title });

  // ── Management ──
  const [admin] = await db.insert(users).values({ ...mk("مدير النظام", "admin@sellerctrl.com", "system_admin", "مدير النظام"), username: "admin" }).returning();
  const [ops] = await db.insert(users).values(mk("مدير العمليات", "ops@sellerctrl.com", "ops_manager", "مدير العمليات")).returning();
  const [lead] = await db.insert(users).values(mk("قائد الفريق", "lead@sellerctrl.com", "team_lead", "قائد فريق")).returning();

  // ── 2 employees ──
  const [ahmed] = await db.insert(users).values(mk("أحمد علي", "ahmed@sellerctrl.com", "employee", "أخصائي منتجات")).returning();
  const [mona] = await db.insert(users).values(mk("منى سالم", "mona@sellerctrl.com", "employee", "أخصائية منتجات")).returning();

  // ── 2 clients ──
  const [client1] = await db.insert(users).values(mk("متجر النخبة", "client1@sellerctrl.com", "client", "بائع")).returning();
  const [client2] = await db.insert(users).values(mk("متجر الأناقة", "client2@sellerctrl.com", "client", "بائع")).returning();

  // ── Default statuses (§10) ──
  const statusSeed = [
    { name: "جديد", color: "#3b82f6", sortOrder: 0, isDefault: true, isTerminal: false },
    { name: "قيد العمل", color: "#f59e0b", sortOrder: 1, isDefault: false, isTerminal: false },
    { name: "يحتاج مراجعة", color: "#8b5cf6", sortOrder: 2, isDefault: false, isTerminal: false },
    { name: "مكتمل", color: "#22c55e", sortOrder: 3, isDefault: false, isTerminal: true },
    { name: "مرفوض", color: "#ef4444", sortOrder: 4, isDefault: false, isTerminal: true },
    { name: "مشكلة", color: "#dc2626", sortOrder: 5, isDefault: false, isTerminal: false },
  ];
  const statuses = await db.insert(productStatuses).values(statusSeed).returning();
  const S = Object.fromEntries(statuses.map((s) => [s.name, s.id]));

  // ── Organization (the single tenant) ──
  const [org] = await db
    .insert(organizations)
    .values({ nameAr: "سيلر كنترول التجارية", nameEn: "SellerCtrl Trading", slug: "sellerctrl", status: "active" })
    .returning();

  // ERP membership roles per user (system_admin is global → no membership needed).
  await db.insert(organizationMembers).values([
    { organizationId: org.id, userId: ops.id, role: "admin" },
    { organizationId: org.id, userId: lead.id, role: "accountant" },
    { organizationId: org.id, userId: ahmed.id, role: "inventory" },
    { organizationId: org.id, userId: mona.id, role: "sales" },
  ]);

  // ── Chart of accounts (hierarchical tree, for the organization) ──
  const coa: { code: string; nameAr: string; type: string; normalBalance: string; isLeaf: boolean; parent: string | null }[] = [
    { code: "1", nameAr: "الأصول", type: "ASSET", normalBalance: "DEBIT", isLeaf: false, parent: null },
    { code: "11", nameAr: "الأصول المتداولة", type: "ASSET", normalBalance: "DEBIT", isLeaf: false, parent: "1" },
    { code: "1101", nameAr: "النقدية", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
    { code: "1102", nameAr: "البنك", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
    { code: "1103", nameAr: "العملاء (المدينون)", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
    { code: "1104", nameAr: "المخزون", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
    { code: "1107", nameAr: "ضريبة المدخلات", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
    { code: "2", nameAr: "الخصوم", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: false, parent: null },
    { code: "21", nameAr: "الخصوم المتداولة", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: false, parent: "2" },
    { code: "2101", nameAr: "الموردون (الدائنون)", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
    { code: "2102", nameAr: "ضريبة المخرجات", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
    { code: "2103", nameAr: "بضاعة مستلمة لم تُفوتر", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
    { code: "3", nameAr: "حقوق الملكية", type: "EQUITY", normalBalance: "CREDIT", isLeaf: false, parent: null },
    { code: "3101", nameAr: "رأس المال", type: "EQUITY", normalBalance: "CREDIT", isLeaf: true, parent: "3" },
    { code: "4", nameAr: "الإيرادات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: false, parent: null },
    { code: "4101", nameAr: "إيرادات المبيعات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
    { code: "4102", nameAr: "مردودات المبيعات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
    { code: "4201", nameAr: "فائض المخزون (أرباح جرد)", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
    { code: "5", nameAr: "المصروفات", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: false, parent: null },
    { code: "5101", nameAr: "تكلفة البضاعة المباعة", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
    { code: "5201", nameAr: "مصروفات عمومية وإدارية", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
    { code: "5301", nameAr: "عجز وتالف المخزون (خسائر جرد)", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
  ];
  const insertedAccs = await db.insert(accounts)
    .values(coa.map(({ parent, ...a }) => ({ ...a, organizationId: org.id })))
    .returning({ id: accounts.id, code: accounts.code });
  const accIdByCode = Object.fromEntries(insertedAccs.map((a) => [a.code, a.id]));
  for (const a of coa) {
    if (a.parent) {
      await db.update(accounts).set({ parentId: accIdByCode[a.parent] })
        .where(and(eq(accounts.organizationId, org.id), eq(accounts.code, a.code)));
    }
  }

  // ── Accounting setup: journals + current fiscal period ──
  await db.insert(accountingJournals).values([
    { organizationId: org.id, code: "GJ", nameAr: "اليومية العامة", type: "GENERAL", sequencePrefix: "JV" },
    { organizationId: org.id, code: "SJ", nameAr: "يومية المبيعات", type: "SALES", sequencePrefix: "SI" },
    { organizationId: org.id, code: "PJ", nameAr: "يومية المشتريات", type: "PURCHASE", sequencePrefix: "PI" },
  ]);
  await db.insert(fiscalPeriods).values({
    organizationId: org.id,
    name: "السنة المالية 2026",
    startDate: new Date(Date.UTC(2026, 0, 1)),
    endDate: new Date(Date.UTC(2026, 11, 31, 23, 59, 59)),
    status: "OPEN",
  });

  // ── ERP master data (customers / suppliers / items / investors) ──
  await db.insert(customers).values([
    { organizationId: org.id, code: "C-001", nameAr: "مؤسسة الرياض للتجارة", phone: "0551234567", creditLimit: "50000", balance: "12500", paymentTerms: 30 },
    { organizationId: org.id, code: "C-002", nameAr: "شركة جدة للإلكترونيات", phone: "0567654321", creditLimit: "30000", balance: "0", paymentTerms: 15 },
    { organizationId: org.id, code: "C-003", nameAr: "متجر الدمام", phone: "0509998888", creditLimit: "20000", balance: "4300", paymentTerms: 30 },
  ]);
  await db.insert(suppliers).values([
    { organizationId: org.id, code: "S-001", nameAr: "مورد الإلكترونيات الدولي", phone: "0541112222", balance: "8000", paymentTerms: 30 },
    { organizationId: org.id, code: "S-002", nameAr: "شركة التوريدات الحديثة", phone: "0543334444", balance: "0", paymentTerms: 45 },
  ]);
  await db.insert(warehouses).values([
    { organizationId: org.id, code: "WH-01", nameAr: "المستودع الرئيسي", type: "WAREHOUSE" },
    { organizationId: org.id, code: "WH-02", nameAr: "مستودع الفرع", type: "WAREHOUSE" },
  ]);
  await db.insert(itemsTable).values([
    { organizationId: org.id, code: "ITM-1001", nameAr: "ساعة ذكية رياضية", sellPrice: "499", minStock: "10" },
    { organizationId: org.id, code: "ITM-1002", nameAr: "سماعة بلوتوث لاسلكية", sellPrice: "299", minStock: "100" },
    { organizationId: org.id, code: "ITM-1003", nameAr: "شاحن سريع 65 واط", sellPrice: "159", minStock: "30" },
    { organizationId: org.id, code: "ITM-1004", nameAr: "حقيبة ظهر للابتوب", sellPrice: "229", minStock: "8" },
  ]);
  await db.insert(investors).values([
    { organizationId: org.id, code: "INV-001", fullName: "عبدالله المالكي", phone: "0551112222", status: "active" },
    { organizationId: org.id, code: "INV-002", fullName: "سارة العتيبي", phone: "0553334444", status: "active" },
  ]);

  // ── Cost centers (financial-dimension tree) ──
  const ccData = [
    { code: "ADMIN", nameAr: "الإدارة العامة", parent: null as string | null },
    { code: "SALES", nameAr: "المبيعات", parent: null as string | null },
    { code: "SALES-AMZ", nameAr: "مبيعات أمازون", parent: "SALES" },
    { code: "SALES-NOON", nameAr: "مبيعات نون", parent: "SALES" },
  ];
  const ccInserted = await db.insert(costCenters)
    .values(ccData.map(({ parent, ...c }) => ({ ...c, organizationId: org.id })))
    .returning({ id: costCenters.id, code: costCenters.code });
  const ccByCode = Object.fromEntries(ccInserted.map((c) => [c.code, c.id]));
  for (const c of ccData) {
    if (c.parent) {
      await db.update(costCenters).set({ parentId: ccByCode[c.parent] })
        .where(and(eq(costCenters.organizationId, org.id), eq(costCenters.code, c.code)));
    }
  }

  // ── Account + party + item lookups ──
  const allAccs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(eq(accounts.organizationId, org.id));
  const A = Object.fromEntries(allAccs.map((a) => [a.code, a.id]));
  const custByCode = Object.fromEntries(
    (await db.select({ code: customers.code, id: customers.id }).from(customers).where(eq(customers.organizationId, org.id)))
      .map((c) => [c.code, c.id]),
  );
  const supByCode = Object.fromEntries(
    (await db.select({ code: suppliers.code, id: suppliers.id }).from(suppliers).where(eq(suppliers.organizationId, org.id)))
      .map((s) => [s.code, s.id]),
  );
  const itemByCode = Object.fromEntries(
    (await db.select({ code: itemsTable.code, id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.organizationId, org.id)))
      .map((i) => [i.code, i.id]),
  );
  const [demoWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.organizationId, org.id)).limit(1);
  const demoItemId = itemByCode["ITM-1001"];

  // ── Demo item codes (barcode/SKU/ASIN) so item search + barcode scan work ──
  const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const demoCodes = [
    { code: "ITM-1001", type: "BARCODE", value: "6221031499011" },
    { code: "ITM-1001", type: "SKU", value: "SK-1001" },
    { code: "ITM-1002", type: "BARCODE", value: "6221031499028" },
    { code: "ITM-1002", type: "ASIN", value: "B08AAA1002" },
    { code: "ITM-1003", type: "BARCODE", value: "6221031499035" },
    { code: "ITM-1004", type: "SKU", value: "SK-1004" },
  ].filter((c) => itemByCode[c.code]);
  if (demoCodes.length) {
    await db.insert(itemCodes).values(demoCodes.map((c) => ({
      itemId: itemByCode[c.code], organizationId: org.id, codeType: c.type, code: c.value, normalizedCode: normCode(c.value), isPrimary: c.type === "BARCODE",
    })));
  }

  // ── Opening stock (Dr Inventory / Cr Capital) + ledger movements ──
  const opening = [
    { code: "ITM-1001", qty: 100, cost: 300 },
    { code: "ITM-1002", qty: 80, cost: 180 },
    { code: "ITM-1003", qty: 200, cost: 90 },
    { code: "ITM-1004", qty: 50, cost: 140 },
  ];
  const openingValue = opening.reduce((s, o) => s + o.qty * o.cost, 0);
  const openingCash = 50000;
  await db.transaction(async (tx) => {
    await postEntry(tx, {
      orgId: org.id, date: new Date(2026, 0, 1), sourceType: "OPENING_BALANCE", sourceId: `opening-${org.id}`,
      description: "أرصدة افتتاحية (مخزون + نقدية)", journalType: "GENERAL",
      lines: [
        { accountId: A["1104"], debit: openingValue, credit: 0, description: "مخزون افتتاحي" },
        { accountId: A["1101"], debit: openingCash, credit: 0, description: "نقدية افتتاحية" },
        { accountId: A["3101"], debit: 0, credit: openingValue + openingCash, description: "رأس المال" },
      ],
    });
    for (const o of opening) {
      await postStockMovement(tx, {
        orgId: org.id, itemId: itemByCode[o.code], warehouseId: demoWh.id, type: "IN",
        quantity: o.qty, unitCost: o.cost, date: new Date(2026, 0, 1),
        referenceType: "OPENING_STOCK", referenceId: "opening", reason: "رصيد افتتاحي",
      });
    }
  });

  // ── Sales invoices: post to GL (revenue + VAT) + stock OUT at WAC + COGS ──
  let rvSeq = 0;
  const addSale = (n: string, custCode: string, d: Date, due: Date, qty: number, unitPrice: number, tax: number, paid = 0) =>
    db.transaction(async (tx) => {
      const sub = qty * unitPrice;
      const total = sub + tax;
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: org.id, number: n, customerId: custByCode[custCode], date: d, dueDate: due,
        status: "DRAFT", subtotal: String(sub), taxAmount: String(tax), totalAmount: String(total),
        paidAmount: String(paid), balanceDue: String(total - paid),
      }).returning();
      await tx.insert(salesInvoiceLines).values({
        salesInvoiceId: inv.id, itemId: demoItemId, quantity: String(qty), unitPrice: String(unitPrice),
        discountAmount: "0", taxAmount: String(tax), totalAmount: String(total),
      });
      await postEntry(tx, {
        orgId: org.id, date: d, sourceType: "SALES_INVOICE", sourceId: inv.id,
        description: `فاتورة بيع ${n}`, journalType: "SALES",
        lines: [
          { accountId: A["1103"], debit: total, credit: 0 },
          { accountId: A["4101"], debit: 0, credit: sub },
          { accountId: A["2102"], debit: 0, credit: tax },
        ],
      });
      const r = await postStockMovement(tx, {
        orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "OUT",
        quantity: qty, date: d, referenceType: "SALES_INVOICE", referenceId: inv.id, reason: `صرف بيع ${n}`,
      });
      if (r.totalCost > 0) {
        await postEntry(tx, {
          orgId: org.id, date: d, sourceType: "SALES_COGS", sourceId: inv.id,
          description: `تكلفة بضاعة مباعة ${n}`, journalType: "GENERAL",
          lines: [
            { accountId: A["5101"], debit: r.totalCost, credit: 0 },
            { accountId: A["1104"], debit: 0, credit: r.totalCost },
          ],
        });
      }
      if (paid > 0) {
        rvSeq += 1;
        const rvNo = `RV-2026-${String(rvSeq).padStart(4, "0")}`;
        const [rv] = await tx.insert(receiptVouchers).values({
          organizationId: org.id, number: rvNo, customerId: custByCode[custCode], salesInvoiceId: inv.id,
          cashAccountId: A["1101"], status: "POSTED", amount: String(paid), date: due, paymentMethod: "CASH", notes: `تحصيل من ${n}`,
        }).returning({ id: receiptVouchers.id });
        await postEntry(tx, {
          orgId: org.id, date: due, sourceType: "RECEIPT_VOUCHER", sourceId: rv.id,
          description: `سند قبض ${rvNo} — فاتورة ${n}`, journalType: "GENERAL",
          lines: [
            { accountId: A["1101"], debit: paid, credit: 0 },
            { accountId: A["1103"], debit: 0, credit: paid },
          ],
        });
      }
      await tx.update(salesInvoices).set({ status: paid > 0 ? "PARTIAL_PAID" : "POSTED" }).where(eq(salesInvoices.id, inv.id));
    });

  // ── Purchase invoices: post to GL (inventory + VAT input) + stock IN at cost ──
  const addPurchase = (n: string, supCode: string, d: Date, due: Date, qty: number, unitPrice: number, tax: number) =>
    db.transaction(async (tx) => {
      const sub = qty * unitPrice;
      const total = sub + tax;
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: org.id, number: n, supplierId: supByCode[supCode], warehouseId: demoWh.id, date: d, dueDate: due,
        status: "DRAFT", subtotal: String(sub), taxAmount: String(tax), totalAmount: String(total),
        paidAmount: "0", balanceDue: String(total),
      }).returning();
      await tx.insert(purchaseInvoiceLines).values({
        purchaseInvoiceId: inv.id, itemId: demoItemId, quantity: String(qty), unitPrice: String(unitPrice),
        discountAmount: "0", taxAmount: String(tax), totalAmount: String(total),
      });
      await postEntry(tx, {
        orgId: org.id, date: d, sourceType: "PURCHASE_INVOICE", sourceId: inv.id,
        description: `فاتورة شراء ${n}`, journalType: "PURCHASE",
        lines: [
          { accountId: A["1104"], debit: sub, credit: 0 },
          { accountId: A["1107"], debit: tax, credit: 0 },
          { accountId: A["2101"], debit: 0, credit: total },
        ],
      });
      await postStockMovement(tx, {
        orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "IN",
        quantity: qty, unitCost: unitPrice, date: d,
        referenceType: "PURCHASE_INVOICE", referenceId: inv.id, reason: `استلام شراء ${n}`,
      });
      await tx.update(purchaseInvoices).set({ status: "POSTED" }).where(eq(purchaseInvoices.id, inv.id));
    });

  // Sales spread (today ≈ 2026-06-20): current / 1-30 / 31-60 / 61-90 / 90+ buckets.
  await addSale("SI-2026-0001", "C-001", new Date(2026, 5, 10), new Date(2026, 6, 10), 2, 500, 150);
  await addSale("SI-2026-0002", "C-001", new Date(2026, 2, 1), new Date(2026, 2, 31), 5, 1000, 750);
  await addSale("SI-2026-0003", "C-002", new Date(2026, 3, 16), new Date(2026, 4, 1), 3, 1000, 450, 1450);
  await addSale("SI-2026-0004", "C-003", new Date(2026, 1, 1), new Date(2026, 2, 2), 2, 1000, 300);
  await addSale("SI-2026-0005", "C-003", new Date(2026, 5, 15), new Date(2026, 5, 30), 2, 1000, 300);

  // Purchase spread.
  await addPurchase("PI-2026-0001", "S-001", new Date(2026, 3, 1), new Date(2026, 4, 1), 10, 400, 600);
  await addPurchase("PI-2026-0002", "S-001", new Date(2026, 1, 15), new Date(2026, 2, 17), 10, 300, 450);
  await addPurchase("PI-2026-0003", "S-002", new Date(2026, 5, 1), new Date(2026, 6, 16), 10, 500, 750);

  // Demo supplier payment (partial) — settles part of PI-2026-0001.
  {
    const [pi] = await db.select({ id: purchaseInvoices.id, supplierId: purchaseInvoices.supplierId, paidAmount: purchaseInvoices.paidAmount, balanceDue: purchaseInvoices.balanceDue })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, org.id), eq(purchaseInvoices.number, "PI-2026-0001"))).limit(1);
    if (pi) {
      const payAmt = 2000;
      await db.transaction(async (tx) => {
        const [pv] = await tx.insert(paymentVouchers).values({
          organizationId: org.id, number: "PV-2026-0001", supplierId: pi.supplierId, purchaseInvoiceId: pi.id,
          cashAccountId: A["1101"], status: "POSTED", amount: String(payAmt), date: new Date(2026, 4, 5), paymentMethod: "CASH", notes: "دفعة للمورد",
        }).returning({ id: paymentVouchers.id });
        await postEntry(tx, {
          orgId: org.id, date: new Date(2026, 4, 5), sourceType: "PAYMENT_VOUCHER", sourceId: pv.id,
          description: "سند صرف PV-2026-0001 — فاتورة PI-2026-0001", journalType: "GENERAL",
          lines: [
            { accountId: A["2101"], debit: payAmt, credit: 0 },
            { accountId: A["1101"], debit: 0, credit: payAmt },
          ],
        });
        await tx.update(purchaseInvoices).set({
          paidAmount: String(Number(pi.paidAmount) + payAmt),
          balanceDue: String(Number(pi.balanceDue) - payAmt),
          status: "PARTIAL_PAID",
        }).where(eq(purchaseInvoices.id, pi.id));
      });
    }
  }

  // Manual G&A expense JE (demonstrates manual posting + cost-center dimension).
  await db.transaction((tx) =>
    postEntry(tx, {
      orgId: org.id, date: new Date(2026, 5, 5), sourceType: "MANUAL", sourceId: randomUUID(),
      description: "مصروف إيجار ومرافق — يونيو", journalType: "GENERAL",
      lines: [
        { accountId: A["5201"], debit: 1200, credit: 0, costCenterId: ccByCode["ADMIN"], description: "إيجار ومرافق" },
        { accountId: A["1101"], debit: 0, credit: 1200, description: "سداد نقدي" },
      ],
    }),
  );

  // Reconcile subledger balances = sum of open balanceDue per party.
  for (const [code, id] of Object.entries(custByCode)) {
    void code;
    const rows = await db.select({ b: salesInvoices.balanceDue }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, org.id), eq(salesInvoices.customerId, id)));
    await db.update(customers).set({ balance: String(rows.reduce((s, r) => s + Number(r.b), 0)) }).where(eq(customers.id, id));
  }
  for (const [code, id] of Object.entries(supByCode)) {
    void code;
    const rows = await db.select({ b: purchaseInvoices.balanceDue }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, org.id), eq(purchaseInvoices.supplierId, id)));
    await db.update(suppliers).set({ balance: String(rows.reduce((s, r) => s + Number(r.b), 0)) }).where(eq(suppliers.id, id));
  }

  // ── Demo returns (credit/debit notes) — run AFTER reconcile so they net the party balances ──
  const r2 = (n: number) => Math.round(n * 100) / 100;
  {
    // Sales return: 1 unit from SI-2026-0001 (qty 2 @ 500, 15% tax).
    const [si] = await db.select({ id: salesInvoices.id, customerId: salesInvoices.customerId, subtotal: salesInvoices.subtotal, taxAmount: salesInvoices.taxAmount })
      .from(salesInvoices).where(and(eq(salesInvoices.organizationId, org.id), eq(salesInvoices.number, "SI-2026-0001"))).limit(1);
    if (si) {
      const net = 500, rate = Number(si.subtotal) > 0 ? Number(si.taxAmount) / Number(si.subtotal) : 0;
      const tax = r2(net * rate), total = r2(net + tax);
      await db.transaction(async (tx) => {
        const [ret] = await tx.insert(salesReturns).values({
          organizationId: org.id, number: "SR-2026-0001", date: new Date(2026, 5, 18), status: "POSTED",
          customerId: si.customerId, warehouseId: demoWh.id, salesInvoiceId: si.id, totalAmount: String(total), notes: "صنف تالف",
        }).returning({ id: salesReturns.id });
        await tx.insert(salesReturnLines).values({ salesReturnId: ret.id, itemId: demoItemId, quantity: "1", unitPrice: "500", totalAmount: "500" });
        const rl = [
          { accountId: A["4102"], debit: net, credit: 0, description: "مرتجع SR-2026-0001" },
          { accountId: A["1103"], debit: 0, credit: total, description: "إشعار دائن SI-2026-0001" },
        ];
        if (tax > 0) rl.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0, description: "عكس ضريبة" });
        await postEntry(tx, { orgId: org.id, date: new Date(2026, 5, 18), sourceType: "SALES_RETURN", sourceId: ret.id, description: "مرتجع مبيعات SR-2026-0001", journalType: "SALES", lines: rl });
        const { avgCost } = await currentStock(org.id, demoItemId, demoWh.id, tx);
        const r = await postStockMovement(tx, { orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "IN", quantity: 1, unitCost: avgCost, date: new Date(2026, 5, 18), referenceType: "SALES_RETURN", referenceId: ret.id, reason: "مرتجع بيع" });
        if (r.totalCost > 0) {
          await postEntry(tx, { orgId: org.id, date: new Date(2026, 5, 18), sourceType: "SALES_RETURN_COGS", sourceId: ret.id, description: "عكس ت.ب.م SR-2026-0001", journalType: "GENERAL", lines: [{ accountId: A["1104"], debit: r.totalCost, credit: 0 }, { accountId: A["5101"], debit: 0, credit: r.totalCost }] });
        }
        await tx.update(customers).set({ balance: sql`${customers.balance} - ${total}` }).where(eq(customers.id, si.customerId));
      });
    }

    // Purchase return: 2 units from PI-2026-0002 (qty 10 @ 300, 15% tax).
    const [pi] = await db.select({ id: purchaseInvoices.id, supplierId: purchaseInvoices.supplierId, warehouseId: purchaseInvoices.warehouseId, subtotal: purchaseInvoices.subtotal, taxAmount: purchaseInvoices.taxAmount })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, org.id), eq(purchaseInvoices.number, "PI-2026-0002"))).limit(1);
    if (pi) {
      const qty = 2, price = 300, net = qty * price;
      const rate = Number(pi.subtotal) > 0 ? Number(pi.taxAmount) / Number(pi.subtotal) : 0;
      const tax = r2(net * rate), total = r2(net + tax);
      await db.transaction(async (tx) => {
        const [ret] = await tx.insert(purchaseReturns).values({
          organizationId: org.id, number: "PR-2026-0001", date: new Date(2026, 2, 20), status: "POSTED",
          supplierId: pi.supplierId, warehouseId: pi.warehouseId, purchaseInvoiceId: pi.id, totalAmount: String(total), notes: "صنف غير مطابق",
        }).returning({ id: purchaseReturns.id });
        await tx.insert(purchaseReturnLines).values({ purchaseReturnId: ret.id, itemId: demoItemId, quantity: String(qty), unitPrice: String(price), totalAmount: String(net) });
        await postStockMovement(tx, { orgId: org.id, itemId: demoItemId, warehouseId: pi.warehouseId, type: "OUT", quantity: qty, unitCost: price, date: new Date(2026, 2, 20), referenceType: "PURCHASE_RETURN", referenceId: ret.id, reason: "مرتجع شراء" });
        const gl = [
          { accountId: A["2101"], debit: total, credit: 0, description: "إشعار مدين PI-2026-0002" },
          { accountId: A["1104"], debit: 0, credit: net, description: "إرجاع مخزون PR-2026-0001" },
        ];
        if (tax > 0) gl.push({ accountId: A["1107"], debit: 0, credit: tax, description: "عكس ضريبة مدخلات" });
        await postEntry(tx, { orgId: org.id, date: new Date(2026, 2, 20), sourceType: "PURCHASE_RETURN", sourceId: ret.id, description: "مرتجع مشتريات PR-2026-0001", journalType: "PURCHASE", lines: gl });
        await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${total}` }).where(eq(suppliers.id, pi.supplierId));
      });
    }

    // ── DRAFT demo returns (awaiting confirmation) — header + lines only, no GL/stock/balance ──
    if (si) {
      const dnet = 500, drate = Number(si.subtotal) > 0 ? Number(si.taxAmount) / Number(si.subtotal) : 0;
      const dtotal = r2(dnet + r2(dnet * drate));
      const [dret] = await db.insert(salesReturns).values({
        organizationId: org.id, number: "SR-2026-0002", date: new Date(2026, 5, 19), status: "DRAFT",
        customerId: si.customerId, warehouseId: demoWh.id, salesInvoiceId: si.id, totalAmount: String(dtotal), notes: "بانتظار التأكيد",
      }).returning({ id: salesReturns.id });
      await db.insert(salesReturnLines).values({ salesReturnId: dret.id, itemId: demoItemId, quantity: "1", unitPrice: "500", totalAmount: "500" });
    }
    if (pi) {
      const dnet = 300, drate = Number(pi.subtotal) > 0 ? Number(pi.taxAmount) / Number(pi.subtotal) : 0;
      const dtotal = r2(dnet + r2(dnet * drate));
      const [dret] = await db.insert(purchaseReturns).values({
        organizationId: org.id, number: "PR-2026-0002", date: new Date(2026, 2, 21), status: "DRAFT",
        supplierId: pi.supplierId, warehouseId: pi.warehouseId, purchaseInvoiceId: pi.id, totalAmount: String(dtotal), notes: "بانتظار التأكيد",
      }).returning({ id: purchaseReturns.id });
      await db.insert(purchaseReturnLines).values({ purchaseReturnId: dret.id, itemId: demoItemId, quantity: "1", unitPrice: "300", totalAmount: "300" });
    }
  }

  // ── Demo stock operations (adjustment + transfer) ──
  const [wh2] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, org.id), eq(warehouses.code, "WH-02"))).limit(1);
  {
    // Damage adjustment (POSTED): ITM-1004 deficit 2 at WAC — header + movement + GL.
    const itm4 = itemByCode["ITM-1004"];
    await db.transaction(async (tx) => {
      const [adj] = await tx.insert(stockAdjustments).values({
        organizationId: org.id, number: "AJ-2026-0001", date: new Date(2026, 5, 17), status: "POSTED",
        itemId: itm4, warehouseId: demoWh.id, mode: "delta", enteredValue: "-2", deltaQuantity: "-2", reason: "تالف",
      }).returning({ id: stockAdjustments.id });
      const r = await postStockMovement(tx, {
        orgId: org.id, itemId: itm4, warehouseId: demoWh.id, type: "ADJ",
        quantity: -2, date: new Date(2026, 5, 17), referenceType: "ADJUSTMENT", referenceId: adj.id, reason: "تالف",
      });
      if (r.totalCost > 0) {
        await postEntry(tx, {
          orgId: org.id, date: new Date(2026, 5, 17), sourceType: "STOCK_ADJUSTMENT", sourceId: adj.id,
          description: "تسوية مخزون AJ-2026-0001 — تالف", journalType: "GENERAL",
          lines: [
            { accountId: A["5301"], debit: r.totalCost, credit: 0 },
            { accountId: A["1104"], debit: 0, credit: r.totalCost },
          ],
        });
      }
      await tx.update(stockAdjustments).set({ totalValue: String(Math.round(r.totalCost * 100) / 100), movementId: r.movementId }).where(eq(stockAdjustments.id, adj.id));
    });

    // Draft adjustment (awaiting confirmation): ITM-1002 surplus +5 — header only, no movement/GL.
    const itm2 = itemByCode["ITM-1002"];
    if (itm2) {
      await db.insert(stockAdjustments).values({
        organizationId: org.id, number: "AJ-2026-0002", date: new Date(2026, 5, 19), status: "DRAFT",
        itemId: itm2, warehouseId: demoWh.id, mode: "delta", enteredValue: "5", deltaQuantity: "5",
        totalValue: "0", reason: "فرق جرد فعلي", notes: "بانتظار التأكيد",
      });
    }

    // Transfer (POSTED): 20 units of ITM-1001 from WH-01 → WH-02 (no GL).
    if (wh2) {
      await db.transaction(async (tx) => {
        const [tr] = await tx.insert(stockTransfers).values({
          organizationId: org.id, number: "TR-2026-0001", date: new Date(2026, 5, 18), status: "POSTED",
          fromWarehouseId: demoWh.id, toWarehouseId: wh2.id, notes: "تزويد الفرع",
        }).returning({ id: stockTransfers.id });
        await tx.insert(stockTransferLines).values({ stockTransferId: tr.id, itemId: demoItemId, quantity: "20" });
        const out = await postStockMovement(tx, {
          orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "OUT",
          quantity: 20, date: new Date(2026, 5, 18), referenceType: "TRANSFER", referenceId: tr.id, reason: "تحويل TR-2026-0001",
        });
        await postStockMovement(tx, {
          orgId: org.id, itemId: demoItemId, warehouseId: wh2.id, type: "IN",
          quantity: 20, unitCost: out.unitCost, date: new Date(2026, 5, 18), referenceType: "TRANSFER", referenceId: tr.id, reason: "تحويل TR-2026-0001",
        });
      });

      // Draft transfer (awaiting confirmation): 5 units ITM-1001 WH-01 → WH-02 — header + lines only.
      const [dtr] = await db.insert(stockTransfers).values({
        organizationId: org.id, number: "TR-2026-0002", date: new Date(2026, 5, 19), status: "DRAFT",
        fromWarehouseId: demoWh.id, toWarehouseId: wh2.id, notes: "بانتظار التأكيد",
      }).returning({ id: stockTransfers.id });
      await db.insert(stockTransferLines).values({ stockTransferId: dtr.id, itemId: demoItemId, quantity: "5" });
    }
  }

  // ── Demo orders (document flow: DRAFT, awaiting manual confirmation) ──
  {
    const soSub = 3 * 500, soTax = 225, soTotal = soSub + soTax;
    const [so] = await db.insert(salesOrders).values({
      organizationId: org.id, number: "SO-2026-0001", customerId: custByCode["C-002"], date: new Date(2026, 5, 16),
      dueDate: new Date(2026, 5, 26), status: "DRAFT", subtotal: String(soSub), taxAmount: String(soTax),
      totalAmount: String(soTotal), notes: "أمر بيع تجريبي",
    }).returning({ id: salesOrders.id });
    await db.insert(salesOrderLines).values({
      salesOrderId: so.id, itemId: demoItemId, quantity: "3", unitPrice: "500", taxAmount: String(soTax), totalAmount: String(soTotal),
    });

    const poSub = 10 * 480, poTax = 720, poTotal = poSub + poTax;
    const [po] = await db.insert(purchaseOrders).values({
      organizationId: org.id, number: "PO-2026-0001", supplierId: supByCode["S-002"], warehouseId: demoWh.id, date: new Date(2026, 5, 14),
      status: "DRAFT", subtotal: String(poSub), taxAmount: String(poTax), totalAmount: String(poTotal), notes: "أمر شراء تجريبي",
    }).returning({ id: purchaseOrders.id });
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: po.id, itemId: demoItemId, quantity: "10", unitPrice: "480", taxAmount: String(poTax), totalAmount: String(poTotal),
    });

    // CONFIRMED orders so partial delivery/receipt is testable out of the box.
    const so3Sub = 5 * 500, so3Tax = 375, so3Total = so3Sub + so3Tax;
    const [so3] = await db.insert(salesOrders).values({
      organizationId: org.id, number: "SO-2026-0003", customerId: custByCode["C-002"], date: new Date(2026, 5, 20),
      dueDate: new Date(2026, 5, 30), status: "CONFIRMED", subtotal: String(so3Sub), taxAmount: String(so3Tax),
      totalAmount: String(so3Total), notes: "أمر بيع مؤكّد — جاهز للتسليم الجزئي",
    }).returning({ id: salesOrders.id });
    await db.insert(salesOrderLines).values({
      salesOrderId: so3.id, itemId: demoItemId, quantity: "5", unitPrice: "500", taxAmount: String(so3Tax), totalAmount: String(so3Total),
    });

    const po3Sub = 8 * 480, po3Tax = 576, po3Total = po3Sub + po3Tax;
    const [po3] = await db.insert(purchaseOrders).values({
      organizationId: org.id, number: "PO-2026-0003", supplierId: supByCode["S-002"], warehouseId: demoWh.id, date: new Date(2026, 5, 21),
      status: "CONFIRMED", subtotal: String(po3Sub), taxAmount: String(po3Tax), totalAmount: String(po3Total), notes: "أمر شراء مؤكّد — جاهز للاستلام الجزئي",
    }).returning({ id: purchaseOrders.id });
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: po3.id, itemId: demoItemId, quantity: "8", unitPrice: "480", taxAmount: String(po3Tax), totalAmount: String(po3Total),
    });
  }

  // ── Demo document flow: SO → Delivery (stock+COGS), PO → GRN (stock+GRNI) ──
  {
    // Sales: SO-2026-0002 → delivered (awaiting invoice).
    const soSub = 2 * 500, soTax = 150, soTotal = soSub + soTax;
    await db.transaction(async (tx) => {
      const [so] = await tx.insert(salesOrders).values({
        organizationId: org.id, number: "SO-2026-0002", customerId: custByCode["C-001"], date: new Date(2026, 5, 12),
        status: "DELIVERED", subtotal: String(soSub), taxAmount: String(soTax), totalAmount: String(soTotal), notes: "أمر مُسلّم",
      }).returning({ id: salesOrders.id });
      await tx.insert(salesOrderLines).values({ salesOrderId: so.id, itemId: demoItemId, quantity: "2", unitPrice: "500", taxAmount: String(soTax), totalAmount: String(soTotal) });
      const [dn] = await tx.insert(deliveryNotes).values({
        organizationId: org.id, number: "DLV-2026-0001", date: new Date(2026, 5, 12), status: "DELIVERED",
        salesOrderId: so.id, customerId: custByCode["C-001"], warehouseId: demoWh.id, notes: "تسليم SO-2026-0002",
      }).returning({ id: deliveryNotes.id });
      await tx.insert(deliveryNoteLines).values({ deliveryNoteId: dn.id, itemId: demoItemId, quantity: "2" });
      const r = await postStockMovement(tx, { orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "OUT", quantity: 2, date: new Date(2026, 5, 12), referenceType: "DELIVERY", referenceId: dn.id, reason: "تسليم DLV-2026-0001" });
      if (r.totalCost > 0) {
        await postEntry(tx, { orgId: org.id, date: new Date(2026, 5, 12), sourceType: "DELIVERY_COGS", sourceId: dn.id, description: "ت.ب.م تسليم DLV-2026-0001", journalType: "GENERAL", lines: [{ accountId: A["5101"], debit: r.totalCost, credit: 0 }, { accountId: A["1104"], debit: 0, credit: r.totalCost }] });
      }
    });

    // Purchase: PO-2026-0002 → received (awaiting invoice).
    const poSub = 5 * 400, poNet = poSub;
    await db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrders).values({
        organizationId: org.id, number: "PO-2026-0002", supplierId: supByCode["S-001"], warehouseId: demoWh.id, date: new Date(2026, 5, 13),
        status: "RECEIVED", subtotal: String(poSub), taxAmount: "300", totalAmount: String(poSub + 300), notes: "أمر مُستلم",
      }).returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values({ purchaseOrderId: po.id, itemId: demoItemId, quantity: "5", unitPrice: "400", taxAmount: "300", totalAmount: String(poSub + 300) });
      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: org.id, number: "GRN-2026-0001", date: new Date(2026, 5, 13), status: "RECEIVED",
        purchaseOrderId: po.id, supplierId: supByCode["S-001"], warehouseId: demoWh.id, notes: "استلام PO-2026-0002",
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values({ purchaseReceiptId: grn.id, itemId: demoItemId, quantity: "5" });
      await postStockMovement(tx, { orgId: org.id, itemId: demoItemId, warehouseId: demoWh.id, type: "IN", quantity: 5, unitCost: 400, date: new Date(2026, 5, 13), referenceType: "GOODS_RECEIPT", referenceId: grn.id, reason: "استلام GRN-2026-0001" });
      await postEntry(tx, { orgId: org.id, date: new Date(2026, 5, 13), sourceType: "GOODS_RECEIPT", sourceId: grn.id, description: "استلام بضاعة GRN-2026-0001", journalType: "PURCHASE", lines: [{ accountId: A["1104"], debit: poNet, credit: 0 }, { accountId: A["2103"], debit: 0, credit: poNet }] });
    });
  }

  // ── Demo DRAFT vouchers (showcase Draft→Confirm — no GL until confirmed) ──
  {
    const [si] = await db.select({ id: salesInvoices.id, customerId: salesInvoices.customerId })
      .from(salesInvoices).where(and(eq(salesInvoices.organizationId, org.id), eq(salesInvoices.number, "SI-2026-0001"))).limit(1);
    if (si) {
      await db.insert(receiptVouchers).values({
        organizationId: org.id, number: "RV-2026-0002", customerId: si.customerId, salesInvoiceId: si.id,
        cashAccountId: A["1101"], status: "DRAFT", amount: "500", date: new Date(2026, 5, 19), paymentMethod: "CASH", notes: "تحصيل (مسودة)",
      });
    }
    const [pi3] = await db.select({ id: purchaseInvoices.id, supplierId: purchaseInvoices.supplierId })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, org.id), eq(purchaseInvoices.number, "PI-2026-0003"))).limit(1);
    if (pi3) {
      await db.insert(paymentVouchers).values({
        organizationId: org.id, number: "PV-2026-0002", supplierId: pi3.supplierId, purchaseInvoiceId: pi3.id,
        cashAccountId: A["1101"], status: "DRAFT", amount: "1000", date: new Date(2026, 5, 19), paymentMethod: "BANK", notes: "دفعة (مسودة)",
      });
    }
  }

  // ── Workspaces (one per client) — belong to the organization ──
  const [wsA] = await db.insert(workspaces).values({ organizationId: org.id, name: "متجر النخبة", type: "amazon", clientUserId: client1.id, description: "متجر أمازون — إلكترونيات" }).returning();
  const [wsB] = await db.insert(workspaces).values({ organizationId: org.id, name: "متجر الأناقة", type: "noon", clientUserId: client2.id, description: "متجر نون — إكسسوارات" }).returning();

  await db.insert(workspaceMembers).values([
    { workspaceId: wsA.id, userId: lead.id, memberRole: "team_lead" },
    { workspaceId: wsA.id, userId: ahmed.id, memberRole: "employee" },
    { workspaceId: wsB.id, userId: lead.id, memberRole: "team_lead" },
    { workspaceId: wsB.id, userId: mona.id, memberRole: "employee" },
  ]);

  // ── Products (imported-style data + open columns) ──
  type P = {
    name: string; desc: string; features: string; sizes: string; price: string;
    img: string; status: string; ws: string; assignee: string; code?: string; notes?: string;
  };
  const amzn = "https://www.amazon.sa/dp/";
  const noon = "https://www.noon.com/saudi-ar/";
  const drive = "https://drive.google.com/drive/folders/demo";

  const items: P[] = [
    // متجر النخبة — assigned to Ahmed
    { name: "ساعة ذكية رياضية", desc: "ساعة ذكية بشاشة AMOLED وتتبع للنشاط البدني ومعدل ضربات القلب.", features: "مقاومة للماء، بطارية 14 يوم، GPS مدمج", sizes: "44mm", price: "499.00", img: "watch", status: "جديد", ws: wsA.id, assignee: ahmed.id },
    { name: "سماعة بلوتوث لاسلكية", desc: "سماعة لاسلكية بعزل ضوضاء نشط وجودة صوت عالية.", features: "ANC، 30 ساعة تشغيل، شحن سريع", sizes: "مقاس واحد", price: "299.00", img: "buds", status: "قيد العمل", ws: wsA.id, assignee: ahmed.id, notes: "بحاجة لصور إضافية للألوان" },
    { name: "شاحن سريع 65 واط", desc: "شاحن جداري بمنفذين USB-C يدعم الشحن فائق السرعة.", features: "GaN، 65W، حماية ذكية", sizes: "مدمج", price: "159.00", img: "charger", status: "مكتمل", ws: wsA.id, assignee: ahmed.id, code: "B0CHRG65W" },
    // متجر الأناقة — assigned to Mona
    { name: "حقيبة ظهر للابتوب", desc: "حقيبة ظهر مقاومة للماء بمساحة 25 لتر وحماية للابتوب حتى 16 بوصة.", features: "منفذ USB، جيب مخفي، مريحة", sizes: "16 بوصة", price: "229.00", img: "backpack", status: "يحتاج مراجعة", ws: wsB.id, assignee: mona.id, notes: "مراجعة الوصف قبل النشر" },
    { name: "لوحة مفاتيح ميكانيكية", desc: "لوحة مفاتيح ميكانيكية بإضاءة RGB ومفاتيح زرقاء.", features: "RGB، لاسلكية، قابلة للبرمجة", sizes: "TKL", price: "349.00", img: "keyboard", status: "مكتمل", ws: wsB.id, assignee: mona.id, code: "NOON-KB-RGB" },
    { name: "ماوس لاسلكي", desc: "ماوس لاسلكي خفيف بدقة 16000 DPI واستجابة عالية.", features: "16000 DPI، خفيف، بطارية طويلة", sizes: "متوسط", price: "189.00", img: "mouse", status: "مشكلة", ws: wsB.id, assignee: mona.id, notes: "تأخر وصول البيانات من العميل" },
  ];

  let n = 1000;
  for (const it of items) {
    n++;
    const [b] = await db
      .insert(productBases)
      .values({
        name: it.name,
        description: it.desc,
        features: it.features,
        sizes: it.sizes,
        price: it.price,
        imageUrl: `https://picsum.photos/seed/${it.img}/400/400`,
        galleryUrl: drive,
        productUrl: it.ws === wsA.id ? amzn + "B0" + n : noon + "p-" + n,
      })
      .returning({ id: productBases.id });
    await db.insert(products).values({
      workspaceId: it.ws,
      baseId: b.id,
      sku: `SKU-${n}`,
      statusId: S[it.status],
      assignedTo: it.assignee,
      amazonCode: it.code ?? null,
      notes: it.notes ?? null,
      completedAt: it.status === "مكتمل" ? new Date() : null,
    });
  }

  // A few tasks so dashboards have data
  await db.insert(tasks).values([
    { workspaceId: wsA.id, title: "تجهيز صور منتجات النخبة", assigneeId: ahmed.id, createdById: lead.id, status: "in_progress", priority: "high" },
    { workspaceId: wsB.id, title: "مراجعة أوصاف منتجات الأناقة", assigneeId: mona.id, createdById: lead.id, status: "new", priority: "medium" },
  ]);

  // Initialise document sequences from the explicit numbers seeded above so the
  // first user-created document of each type continues the series (no collision).
  await syncDocumentSequences(org.id);

  // Demo audit trail so the log isn't empty out of the box (mirrors the events
  // that would have produced the seeded documents).
  await db.insert(auditLogs).values([
    { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "PURCHASE_ORDER", entityNumber: "PO-2026-0001", summary: "إنشاء أمر شراء PO-2026-0001 (مسودة)" },
    { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "SALES_ORDER", entityNumber: "SO-2026-0001", summary: "إنشاء أمر بيع SO-2026-0001 (مسودة)" },
    { organizationId: org.id, userId: admin.id, action: "POST", entityType: "PURCHASE_INVOICE", entityNumber: "PI-2026-0002", summary: "ترحيل فاتورة شراء PI-2026-0002" },
    { organizationId: org.id, userId: admin.id, action: "POST", entityType: "SALES_INVOICE", entityNumber: "SI-2026-0001", summary: "ترحيل فاتورة بيع SI-2026-0001" },
    { organizationId: org.id, userId: admin.id, action: "CONFIRM", entityType: "RECEIPT_VOUCHER", entityNumber: "RV-2026-0001", summary: "تأكيد وترحيل سند قبض RV-2026-0001" },
    { organizationId: org.id, userId: admin.id, action: "CONFIRM", entityType: "PAYMENT_VOUCHER", entityNumber: "PV-2026-0001", summary: "تأكيد وترحيل سند صرف PV-2026-0001" },
    { organizationId: org.id, userId: admin.id, action: "POST", entityType: "GOODS_RECEIPT", entityNumber: "GRN-2026-0001", summary: "تأكيد إذن استلام GRN-2026-0001" },
    { organizationId: org.id, userId: admin.id, action: "POST", entityType: "DELIVERY_NOTE", entityNumber: "DLV-2026-0001", summary: "تأكيد إذن صرف DLV-2026-0001" },
  ]);

  console.log("✅ Demo seed complete. All passwords: password123");
  console.log("   مدير:   admin@sellerctrl.com");
  console.log("   موظف 1: ahmed@sellerctrl.com  (يرى منتجات متجر النخبة المكلّف بها)");
  console.log("   موظف 2: mona@sellerctrl.com   (يرى منتجات متجر الأناقة المكلّف بها)");
  console.log("   عميل 1: client1@sellerctrl.com (متجر النخبة)");
  console.log("   عميل 2: client2@sellerctrl.com (متجر الأناقة)");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
