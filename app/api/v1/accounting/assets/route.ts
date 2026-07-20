import { runAsErp } from "@/lib/erp/api-auth";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { fixedAssets } from "@/db/schema";
import { fixedAssetList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    return Response.json({ data: await fixedAssetList(auth.orgId) });
  });
}

/** POST /api/v1/accounting/assets — register a fixed asset (direct core; the cookie
 *  action gates via requireErpModule, unusable from the bearer API).
 *  Body: { code, nameAr, category, purchaseDate, purchaseCost, salvageValue?, usefulLifeYears,
 *          glAssetAccountId?, glAccumDeprecAccountId?, glDeprecExpenseAccountId?, notes? }.
 *
 *  Registers only — equivalent to the web form's "الأصل مُسجَّل بالفعل" (EXISTING)
 *  mode; no acquisition entry is posted. Deliberate: capitalizing needs the user to
 *  say which account paid for the asset and to confirm it isn't already on the books
 *  from a purchase invoice, and that is a decision to make on the web form with the
 *  chart in front of you, not a field to guess from a phone. Capitalize there. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    const b = await req.json().catch(() => ({}));

    const code = String(b.code ?? "").trim();
    const nameAr = String(b.nameAr ?? "").trim();
    if (!code) return Response.json({ error: "الكود مطلوب" }, { status: 400 });
    if (nameAr.length < 2) return Response.json({ error: "الاسم قصير جداً" }, { status: 400 });
    const cost = Number(b.purchaseCost ?? 0);
    const salvage = Number(b.salvageValue ?? 0);
    const life = Number(b.usefulLifeYears ?? 0);
    if (!(life > 0)) return Response.json({ error: "العمر الإنتاجي يجب أن يكون أكبر من صفر" }, { status: 400 });
    const purchaseDate = new Date(String(b.purchaseDate ?? ""));
    if (Number.isNaN(purchaseDate.getTime())) return Response.json({ error: "تاريخ الشراء غير صالح" }, { status: 400 });
    if (!(cost >= 0)) return Response.json({ error: "تكلفة الشراء غير صالحة" }, { status: 400 });
    if (salvage < 0 || salvage > cost) return Response.json({ error: "قيمة الخردة يجب أن تكون بين صفر والتكلفة" }, { status: 400 });

    const [row] = await db.insert(fixedAssets).values({
      organizationId: auth.orgId, code, nameAr, category: String(b.category || "OTHER"),
      purchaseDate, purchaseCost: String(cost), salvageValue: String(salvage), usefulLifeYears: life,
      netBookValue: String(cost),
      glAssetAccountId: b.glAssetAccountId || null,
      glAccumDeprecAccountId: b.glAccumDeprecAccountId || null,
      glDeprecExpenseAccountId: b.glDeprecExpenseAccountId || null,
      notes: b.notes?.trim() || null,
    }).returning({ id: fixedAssets.id });
    emitErpEvent(auth.orgId, { action: "CREATE", entity: "FIXED_ASSET", id: row.id });
    return Response.json({ data: { ok: true, id: row.id } });
  });
}
