"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { parseCsvWithHeader } from "@/lib/erp/csv";
import { WAREHOUSE_TYPES, LABEL_TO_TYPE } from "@/lib/erp/warehouse-types";

// Warehouse hierarchy: a main مخزن with منطقة → رف → صندوق (bin) under it, one level
// deep or many — parentId is a self-ref. `type` is the level label.

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  type: z.enum(WAREHOUSE_TYPES).default("WAREHOUSE"),
  parentId: z.string().optional(),
  location: z.string().optional(),
  manager: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function saveWarehouseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse({
      code: formData.get("code"),
      nameAr: formData.get("nameAr"),
      type: formData.get("type") || "WAREHOUSE",
      parentId: formData.get("parentId") || undefined,
      location: formData.get("location") || undefined,
      manager: formData.get("manager") || undefined,
      isActive: formData.get("isActive") === "on",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (id && parsed.data.parentId === id) return { error: "لا يمكن جعل المخزن أباً لنفسه" };

    const data = {
      code: parsed.data.code.trim(),
      nameAr: parsed.data.nameAr.trim(),
      type: parsed.data.type,
      parentId: parsed.data.parentId || null,
      location: parsed.data.location?.trim() || null,
      manager: parsed.data.manager?.trim() || null,
      isActive: parsed.data.isActive,
    };
    try {
      if (id) {
        await db.update(warehouses).set(data).where(and(eq(warehouses.id, id), eq(warehouses.organizationId, auth.orgId)));
      } else {
        await db.insert(warehouses).values({ ...data, organizationId: auth.orgId });
      }
    } catch (e) {
      return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
    }
    revalidatePath("/inventory/warehouses");
    return { ok: true };
  });
}

export async function deleteWarehouseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.delete(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.organizationId, auth.orgId)));
    } catch {
      return { error: "تعذّر الحذف — قد يكون المخزن به مخازن فرعية أو حركات مخزون" };
    }
    revalidatePath("/inventory/warehouses");
    return { ok: true };
  });
}

/**
 * Bulk import warehouses from CSV. Columns (Arabic or English headers): code,
 * nameAr(الاسم), type(النوع), parentCode(الأب/كود_الأب), location(الموقع),
 * manager(المسؤول), active(نشط). Two passes so parent order in the file doesn't
 * matter: upsert every row by code, then wire parents by their code.
 */
export async function importWarehousesCsvAction(csvText: string): Promise<ActionState & { inserted?: number; updated?: number; errors?: string[] }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const rows = parseCsvWithHeader(csvText);
    if (rows.length < 2) return { error: "الملف فارغ أو بلا صفوف" };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
    const c = {
      code: idx(["code", "الكود", "كود"]),
      name: idx(["namear", "name", "الاسم", "اسم"]),
      type: idx(["type", "النوع", "نوع", "المستوى"]),
      parent: idx(["parentcode", "parent", "الأب", "كود_الأب", "كود الأب", "المخزن الأب"]),
      location: idx(["location", "الموقع", "موقع"]),
      manager: idx(["manager", "المسؤول", "مسؤول", "المدير"]),
      active: idx(["active", "isactive", "نشط"]),
    };
    if (c.code < 0 || c.name < 0) return { error: "أعمدة مفقودة: الكود والاسم مطلوبان" };

    const normType = (v: string) => {
      const s = (v || "").trim();
      if (!s) return "WAREHOUSE";
      const up = s.toUpperCase();
      if ((WAREHOUSE_TYPES as readonly string[]).includes(up)) return up;
      return LABEL_TO_TYPE[s] ?? "WAREHOUSE";
    };
    const truthy = (v: string) => { const s = (v || "").trim().toLowerCase(); return s === "" ? true : !["0", "false", "no", "لا"].includes(s); };

    let inserted = 0, updated = 0;
    const errors: string[] = [];
    const parentByCode: { code: string; parentCode: string }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const code = (r[c.code] ?? "").trim();
      const nameAr = (r[c.name] ?? "").trim();
      if (!code || !nameAr) { errors.push(`صف ${i + 1}: الكود والاسم مطلوبان`); continue; }
      const data = {
        nameAr, type: normType(c.type >= 0 ? r[c.type] : ""),
        location: (c.location >= 0 ? r[c.location] : "").trim() || null,
        manager: (c.manager >= 0 ? r[c.manager] : "").trim() || null,
        isActive: truthy(c.active >= 0 ? r[c.active] : ""),
      };
      try {
        const [existing] = await db.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.code, code))).limit(1);
        if (existing) { await db.update(warehouses).set(data).where(eq(warehouses.id, existing.id)); updated++; }
        else { await db.insert(warehouses).values({ ...data, code, organizationId: auth.orgId }); inserted++; }
        const parentCode = (c.parent >= 0 ? r[c.parent] : "").trim();
        if (parentCode && parentCode !== code) parentByCode.push({ code, parentCode });
      } catch { errors.push(`صف ${i + 1}: تعذّر حفظ «${code}»`); }
    }

    // Pass 2 — resolve parents by code now that every row exists.
    if (parentByCode.length) {
      const all = await db.select({ id: warehouses.id, code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.organizationId, auth.orgId));
      const idByCode = new Map(all.map((w) => [w.code, w.id]));
      for (const { code, parentCode } of parentByCode) {
        const childId = idByCode.get(code), parentId = idByCode.get(parentCode);
        if (childId && parentId && childId !== parentId) {
          await db.update(warehouses).set({ parentId }).where(and(eq(warehouses.id, childId), eq(warehouses.organizationId, auth.orgId)));
        } else if (!parentId) errors.push(`«${code}»: المخزن الأب «${parentCode}» غير موجود`);
      }
    }

    revalidatePath("/inventory/warehouses");
    return { ok: true, inserted, updated, errors: errors.slice(0, 20) };
  });
}
