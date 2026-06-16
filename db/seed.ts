import bcrypt from "bcryptjs";
import { db, pool } from "@/lib/db";
import {
  users,
  workspaces,
  workspaceMembers,
  productStatuses,
  products,
  tasks,
  attendance,
} from "@/db/schema";

/**
 * Seed demo data. Idempotent: clears the relevant tables, then inserts.
 * Run with: npm run db:seed
 */
async function main() {
  console.log("🌱 Seeding SellerCtrl Workspace OS…");

  // Clear in dependency order.
  await db.delete(attendance);
  await db.delete(tasks);
  await db.delete(products);
  await db.delete(workspaceMembers);
  await db.delete(productStatuses);
  await db.delete(workspaces);
  await db.delete(users);

  const pw = await bcrypt.hash("password123", 10);

  // ── Users (one per role + a few employees) ──
  const [admin] = await db
    .insert(users)
    .values({ name: "مدير النظام", email: "admin@sellerctrl.com", passwordHash: pw, role: "system_admin", title: "مدير النظام" })
    .returning();
  const [ops] = await db
    .insert(users)
    .values({ name: "مدير العمليات", email: "ops@sellerctrl.com", passwordHash: pw, role: "ops_manager", title: "مدير العمليات" })
    .returning();
  const [lead] = await db
    .insert(users)
    .values({ name: "قائد الفريق", email: "lead@sellerctrl.com", passwordHash: pw, role: "team_lead", title: "قائد فريق" })
    .returning();

  const employeeSeed = [
    { name: "أحمد علي", email: "ahmed@sellerctrl.com" },
    { name: "محمد حسن", email: "mohammed@sellerctrl.com" },
    { name: "سليم خالد", email: "salim@sellerctrl.com" },
    { name: "سارة يوسف", email: "sara@sellerctrl.com" },
  ];
  const employees = await db
    .insert(users)
    .values(
      employeeSeed.map((e, i) => ({
        name: e.name,
        email: e.email,
        passwordHash: pw,
        role: "employee" as const,
        title: "موظف عمليات",
        // stagger hire dates for experience-based distribution
        hiredAt: new Date(Date.now() - (i + 1) * 90 * 24 * 3600 * 1000),
      })),
    )
    .returning();

  const [client] = await db
    .insert(users)
    .values({ name: "عميل أمازون", email: "client@sellerctrl.com", passwordHash: pw, role: "client", title: "بائع" })
    .returning();

  // ── Default product statuses (global; workspaceId NULL) §10 ──
  const statusSeed = [
    { name: "جديد", color: "#3b82f6", sortOrder: 0, isDefault: true, isTerminal: false },
    { name: "قيد العمل", color: "#f59e0b", sortOrder: 1, isDefault: false, isTerminal: false },
    { name: "يحتاج مراجعة", color: "#8b5cf6", sortOrder: 2, isDefault: false, isTerminal: false },
    { name: "مكتمل", color: "#22c55e", sortOrder: 3, isDefault: false, isTerminal: true },
    { name: "مرفوض", color: "#ef4444", sortOrder: 4, isDefault: false, isTerminal: true },
    { name: "مشكلة", color: "#dc2626", sortOrder: 5, isDefault: false, isTerminal: false },
  ];
  const statuses = await db.insert(productStatuses).values(statusSeed).returning();
  const statusByName = Object.fromEntries(statuses.map((s) => [s.name, s]));

  // ── Workspaces §3 ──
  const [ws1] = await db
    .insert(workspaces)
    .values({ name: "Amazon Store XYZ", type: "amazon", clientUserId: client.id, description: "متجر أمازون للعميل XYZ" })
    .returning();
  const [ws2] = await db
    .insert(workspaces)
    .values({ name: "Noon Store ABC", type: "noon", description: "متجر نون ABC" })
    .returning();
  const [ws3] = await db
    .insert(workspaces)
    .values({ name: "Brand DEF", type: "brand", description: "علامة تجارية DEF" })
    .returning();

  // ── Workspace members §4 ──
  await db.insert(workspaceMembers).values([
    { workspaceId: ws1.id, userId: ops.id, memberRole: "ops_manager" },
    { workspaceId: ws1.id, userId: lead.id, memberRole: "team_lead" },
    { workspaceId: ws1.id, userId: employees[0].id, memberRole: "employee" },
    { workspaceId: ws1.id, userId: employees[1].id, memberRole: "employee" },
    { workspaceId: ws1.id, userId: employees[2].id, memberRole: "employee" },
    { workspaceId: ws2.id, userId: lead.id, memberRole: "team_lead" },
    { workspaceId: ws2.id, userId: employees[2].id, memberRole: "employee" },
    { workspaceId: ws2.id, userId: employees[3].id, memberRole: "employee" },
    { workspaceId: ws3.id, userId: employees[3].id, memberRole: "employee" },
  ]);

  // ── Products §9 ──
  const brands = ["Anker", "Logitech", "Samsung", "Xiaomi", "HP"];
  const productRows = [];
  for (let i = 1; i <= 24; i++) {
    const ws = i <= 14 ? ws1 : i <= 20 ? ws2 : ws3;
    const assignee =
      ws.id === ws1.id
        ? employees[i % 3]
        : ws.id === ws2.id
          ? employees[2 + (i % 2)]
          : employees[3];
    const statusName = statusSeed[i % statusSeed.length].name;
    const status = statusByName[statusName];
    productRows.push({
      workspaceId: ws.id,
      sku: `SKU-${1000 + i}`,
      name: `منتج رقم ${i}`,
      asin: `B0${String(100000 + i)}`,
      brand: brands[i % brands.length],
      price: String((50 + i * 7).toFixed(2)),
      statusId: status.id,
      assignedTo: assignee.id,
      sheetRowRef: null,
      completedAt: status.isTerminal ? new Date(Date.now() - (i % 7) * 86400000) : null,
      notes: i % 4 === 0 ? "بحاجة إلى صور إضافية" : null,
    });
  }
  await db.insert(products).values(productRows);

  // ── A few tasks §12 ──
  await db.insert(tasks).values([
    { workspaceId: ws1.id, title: "مراجعة وصف المنتجات", assigneeId: employees[0].id, createdById: lead.id, status: "in_progress", priority: "high" },
    { workspaceId: ws1.id, title: "رفع الصور المحسّنة", assigneeId: employees[1].id, createdById: lead.id, status: "new", priority: "medium" },
    { workspaceId: ws2.id, title: "تدقيق الأكواد", assigneeId: employees[2].id, createdById: ops.id, status: "review", priority: "urgent" },
    { workspaceId: ws1.id, title: "تقرير أسبوعي", assigneeId: lead.id, createdById: ops.id, status: "done", priority: "low", completedAt: new Date() },
  ]);

  console.log("✅ Seed complete.");
  console.log("   Login with any of:");
  console.log("   admin@sellerctrl.com / ops@sellerctrl.com / lead@sellerctrl.com");
  console.log("   ahmed@sellerctrl.com (employee) / client@sellerctrl.com (client)");
  console.log("   password: password123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
