import bcrypt from "bcryptjs";
import { db, pool } from "@/lib/db";
import {
  users,
  workspaces,
  workspaceMembers,
  productStatuses,
  products,
  productBases,
  tasks,
  attendance,
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
  await db.delete(users);

  const pw = await bcrypt.hash("password123", 10);
  const mk = (name: string, email: string, role: "system_admin" | "ops_manager" | "team_lead" | "employee" | "client", title?: string) =>
    ({ name, email, passwordHash: pw, role, title });

  // ── Management ──
  const [admin] = await db.insert(users).values(mk("مدير النظام", "admin@sellerctrl.com", "system_admin", "مدير النظام")).returning();
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

  // ── Workspaces (one per client) ──
  const [wsA] = await db.insert(workspaces).values({ name: "متجر النخبة", type: "amazon", clientUserId: client1.id, description: "متجر أمازون — إلكترونيات" }).returning();
  const [wsB] = await db.insert(workspaces).values({ name: "متجر الأناقة", type: "noon", clientUserId: client2.id, description: "متجر نون — إكسسوارات" }).returning();

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
